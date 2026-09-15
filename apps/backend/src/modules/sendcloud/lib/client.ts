import { MedusaError } from "@medusajs/framework/utils"
import type {
  AnnounceShipmentRequest,
  SendcloudOptions,
  SendcloudContract,
  SendcloudParcel,
  SendcloudSenderAddress,
  SendcloudServicePointRef,
  SendcloudServicePointSearch,
  SendcloudShippingOption,
  SendcloudShipment,
} from "../types"

const API_BASE = "https://panel.sendcloud.sc/api/v3"
const OAUTH_TOKEN_URL = "https://account.sendcloud.com/oauth2/token"

/**
 * Cache des lectures.
 *
 * Un seul passage en caisse declenche une quinzaine d'appels : Medusa recalcule le prix de
 * *toutes* les options a l'affichage, puis a chaque fois qu'une methode de livraison est
 * posee sur le panier — donc au choix du mode, puis au choix du point relais. Or ces
 * tarifs ne varient ni d'une minute a l'autre, ni d'un client a l'autre : la meme
 * destination et le meme poids donnent la meme reponse.
 *
 * Le cache vit dans la memoire du processus, faute d'acces au module de cache depuis un
 * provider de fulfillment. Il n'est donc partage ni entre repliques ni entre redemarrages ;
 * c'est sans consequence ici, ou une replique sert de nombreux paniers, mais cela reste la
 * limite a lever si la charge le justifiait un jour.
 *
 * Seules les lectures sont mises en cache. Annoncer ou annuler une expedition passe
 * toujours par le reseau.
 */
const CACHE_TTL_MS = 10 * 60 * 1000
/** Plafond, pour qu'une longue serie de codes postaux ne fasse pas enfler la memoire. */
const CACHE_MAX = 500

const cacheLectures = new Map<string, { at: number; valeur: unknown }>()

function lireCache<T>(cle: string): T | undefined {
  const entree = cacheLectures.get(cle)

  if (!entree) return undefined

  if (Date.now() - entree.at >= CACHE_TTL_MS) {
    cacheLectures.delete(cle)
    return undefined
  }

  return entree.valeur as T
}

function ecrireCache(cle: string, valeur: unknown): void {
  // Les entrees sont inserees dans l'ordre : la premiere clef est la plus ancienne.
  if (cacheLectures.size >= CACHE_MAX) {
    const plusAncienne = cacheLectures.keys().next().value
    if (plusAncienne !== undefined) cacheLectures.delete(plusAncienne)
  }

  cacheLectures.set(cle, { at: Date.now(), valeur })
}

/** Marge avant expiration : on renouvelle le jeton un peu avant l'heure. */
const TOKEN_REFRESH_MARGIN_MS = 60_000

/**
 * Client de l'API Sendcloud v3.
 *
 * L'authentification par défaut est Basic — clé publique en identifiant, clé secrète en
 * mot de passe. Une intégration peut cependant être configurée pour *exiger* OAuth2, et
 * Basic y échoue alors : d'où le second mode, dont le jeton vit une heure et se met en
 * cache. La documentation insiste sur ce point, un jeton par appel serait du gaspillage.
 */
export class SendcloudClient {
  private token?: { value: string; expiresAt: number }

  constructor(private readonly options: SendcloudOptions) {}

  /**
   * Options d'expédition disponibles pour un envoi donné, prix compris.
   *
   * Sert deux besoins de Medusa : lister les services proposables au marchand, et
   * calculer le prix d'une méthode de livraison au moment du panier.
   */
  async listShippingOptions(input: {
    fromCountryCode: string
    toCountryCode: string
    fromPostalCode?: string
    toPostalCode?: string
    parcels: SendcloudParcel[]
    /**
     * `last_mile` filtre le dernier kilometre : `home_delivery` ou `service_point`.
     * Sans filtre, Sendcloud rend les deux familles melangees — on interroge donc
     * separement pour savoir laquelle exige un point relais.
     */
    lastMile?: "home_delivery" | "service_point"
    /** Sans devis, la reponse ne porte aucun prix : inutile pour `calculatePrice`. */
    calculateQuotes?: boolean
    toServicePoint?: SendcloudServicePointRef
  }): Promise<SendcloudShippingOption[]> {
    const corps = {
      from_country_code: input.fromCountryCode,
      to_country_code: input.toCountryCode,
      from_postal_code: input.fromPostalCode,
      to_postal_code: input.toPostalCode,
      parcels: input.parcels,
      to_service_point: input.toServicePoint,
      functionalities: input.lastMile ? { last_mile: input.lastMile } : undefined,
      calculate_quotes: input.calculateQuotes ?? false,
    }

    const cle = `options:${JSON.stringify(corps)}`
    const enCache = lireCache<SendcloudShippingOption[]>(cle)

    if (enCache) return enCache

    const body = await this.request<{ data?: SendcloudShippingOption[] }>(
      "POST",
      "/shipping-options",
      corps
    )

    const resultat = body.data ?? []
    ecrireCache(cle, resultat)

    return resultat
  }

  /**
   * Crée l'expédition et demande l'étiquette en un appel.
   *
   * La variante synchrone attend le transporteur : la réponse porte donc directement le
   * numéro de suivi et l'étiquette, ce que le provider de fulfillment doit rendre à Medusa.
   */
  async announceShipment(request: AnnounceShipmentRequest): Promise<SendcloudShipment> {
    const body = await this.request<{ data?: SendcloudShipment }>(
      "POST",
      "/shipments/announce",
      request
    )

    if (!body.data?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Sendcloud a accepté l'expédition mais n'a pas rendu son identifiant."
      )
    }

    return body.data
  }

  /**
   * Document d'un colis — l'étiquette, le plus souvent — en binaire.
   *
   * Le lien que porte la réponse d'annonce pointe ici, mais derrière l'authentification
   * API : c'est ce backend qui va le chercher pour le marchand. `dpi` ne vaut que pour les
   * formats matriciels ; en PDF à 72 points, l'étiquette reste vectorielle.
   */
  async downloadParcelDocument(
    parcelId: number,
    type: "label" | "customs-declaration" | "air-waybill" | "proof-of-delivery" = "label",
    format: "application/pdf" | "application/zpl" | "image/png" = "application/pdf"
  ): Promise<{ contentType: string; body: Buffer }> {
    const res = await fetch(`${API_BASE}/parcels/${parcelId}/documents/${type}`, {
      headers: { ...(await this.authHeaders()), accept: format },
    })

    if (!res.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Sendcloud a répondu ${res.status} sur le document « ${type} » du colis ${parcelId} : ${(await res.text()).slice(0, 500)}`
      )
    }

    return {
      contentType: res.headers.get("content-type") ?? format,
      body: Buffer.from(await res.arrayBuffer()),
    }
  }

  /**
   * Adresses d'expédition enregistrées dans le compte.
   *
   * Le panel en désigne une « par défaut », mais l'API ne rend pas ce drapeau : quand
   * il n'y en a qu'une, c'est forcément elle. Un compte n'en change presque jamais, la
   * réponse est mise en cache comme les autres lectures.
   */
  async listSenderAddresses(): Promise<SendcloudSenderAddress[]> {
    const cle = "sender-addresses"
    const enCache = lireCache<SendcloudSenderAddress[]>(cle)
    if (enCache) return enCache

    const body = await this.request<{ data?: SendcloudSenderAddress[] }>(
      "GET",
      "/addresses/sender-addresses?page_size=100"
    )
    const adresses = body.data ?? []
    ecrireCache(cle, adresses)

    return adresses
  }

  /**
   * Contrats transporteur rattachés au compte.
   *
   * Un compte sans contrat propre expédie aux tarifs négociés par Sendcloud ; avec, il
   * expédie aux siens. C'est aussi ce qui dit si les contrats Colissimo et Chronopost du
   * marchand ont bien été branchés.
   */
  async listContracts(): Promise<SendcloudContract[]> {
    const body = await this.request<SendcloudContract[] | { data?: SendcloudContract[] }>(
      "GET",
      "/contracts"
    )

    return Array.isArray(body) ? body : body.data ?? []
  }

  /** Annule une expédition annoncée, si le transporteur le permet. */
  async cancelShipment(shipmentId: string): Promise<void> {
    await this.request("POST", `/shipments/${encodeURIComponent(shipmentId)}/cancel`)
  }

  /**
   * Points relais d'une zone.
   *
   * Trois façons de cadrer la recherche, selon l'usage : par code postal à l'ouverture du
   * sélecteur, par coordonnées et rayon quand on géolocalise le client, par rectangle
   * englobant quand il déplace la carte. Les noms de paramètres suivent ceux de l'API —
   * `country_code`, `address_postal_code` — et non des raccourcis : envoyer `country`
   * vaut un 400 « Field required ».
   */
  async listServicePoints(input: {
    countryCode: string
    carrierCodes?: string[]
    postalCode?: string
    city?: string
    address?: string
    latitude?: string
    longitude?: string
    /** Rayon en mètres depuis le point de référence. */
    radius?: number
    /** Rectangle englobant, pour suivre les déplacements d'une carte. */
    bounds?: { neLat: string; neLng: string; swLat: string; swLng: string }
  }): Promise<SendcloudServicePointSearch> {
    const params = new URLSearchParams({ country_code: input.countryCode })

    // Sendcloud exige exactement une portee transporteur, et le parametre se **repete** :
    // `carrier_code=colissimo&carrier_code=chronopost`. La liste separee par virgules est
    // refusee en 400. A defaut, on retombe sur les transporteurs actives de l'integration —
    // mais ce mode s'est revele ne remonter qu'un seul reseau, d'ou la liste explicite
    // des que l'appelant sait ce qu'il veut afficher.
    if (input.carrierCodes?.length) {
      for (const code of input.carrierCodes) params.append("carrier_code", code)
    } else {
      params.set("use_integration_carriers", "true")
    }
    // Une seule source de localisation a la fois : adresse structuree, texte libre, ou
    // coordonnees. Les melanger vaut un 400.
    if (input.postalCode) params.set("address_postal_code", input.postalCode)
    if (input.city) params.set("address_city", input.city)
    if (input.address) params.set("address", input.address)
    if (input.latitude) params.set("latitude", input.latitude)
    if (input.longitude) params.set("longitude", input.longitude)
    if (input.radius) params.set("radius", String(input.radius))
    if (input.bounds) {
      params.set("ne_latitude", input.bounds.neLat)
      params.set("ne_longitude", input.bounds.neLng)
      params.set("sw_latitude", input.bounds.swLat)
      params.set("sw_longitude", input.bounds.swLng)
    }

    const cle = `points:${params.toString()}`
    const enCache = lireCache<SendcloudServicePointSearch>(cle)

    if (enCache) return enCache

    const body = await this.request<{ data?: SendcloudServicePointSearch }>(
      "GET",
      `/service-points?${params.toString()}`
    )

    const resultat = { results: body.data?.results ?? [], geocoding: body.data?.geocoding }
    ecrireCache(cle, resultat)

    return resultat
  }

  private async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(await this.authHeaders()),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })

    const text = await res.text()

    if (!res.ok) {
      // Les erreurs Sendcloud portent un corps JSON explicite ; on le transmet tel quel
      // plutôt qu'un « 400 Bad Request » qui n'apprend rien à celui qui lit les logs.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Sendcloud a répondu ${res.status} sur ${method} ${path} : ${text.slice(0, 500)}`
      )
    }

    return (text ? JSON.parse(text) : {}) as T
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.options.useOAuth) {
      const basic = Buffer.from(
        `${this.options.publicKey}:${this.options.secretKey}`
      ).toString("base64")

      return { authorization: `Basic ${basic}` }
    }

    return { authorization: `Bearer ${await this.accessToken()}` }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.token.value
    }

    const basic = Buffer.from(
      `${this.options.publicKey}:${this.options.secretKey}`
    ).toString("base64")

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=api",
    })

    if (!res.ok) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Sendcloud a refusé la demande de jeton OAuth2 (${res.status}).`
      )
    }

    const body = (await res.json()) as { access_token: string; expires_in: number }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    }

    return this.token.value
  }
}
