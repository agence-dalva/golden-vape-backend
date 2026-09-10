import { MedusaError } from "@medusajs/framework/utils"
import type {
  AnnounceShipmentRequest,
  SendcloudOptions,
  SendcloudParcel,
  SendcloudServicePoint,
  SendcloudServicePointRef,
  SendcloudShippingOption,
} from "../types"

const API_BASE = "https://panel.sendcloud.sc/api/v3"
const OAUTH_TOKEN_URL = "https://account.sendcloud.com/oauth2/token"

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
    const body = await this.request<{ data?: SendcloudShippingOption[] }>(
      "POST",
      "/shipping-options",
      {
        from_country_code: input.fromCountryCode,
        to_country_code: input.toCountryCode,
        from_postal_code: input.fromPostalCode,
        to_postal_code: input.toPostalCode,
        parcels: input.parcels,
        to_service_point: input.toServicePoint,
        functionalities: input.lastMile ? { last_mile: input.lastMile } : undefined,
        calculate_quotes: input.calculateQuotes ?? false,
      }
    )

    return body.data ?? []
  }

  /**
   * Crée l'expédition et demande l'étiquette en un appel.
   *
   * La variante synchrone attend le transporteur : la réponse porte donc directement le
   * numéro de suivi et l'étiquette, ce que le provider de fulfillment doit rendre à Medusa.
   */
  async announceShipment(request: AnnounceShipmentRequest): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/shipments/announce", request)
  }

  /** Annule une expédition annoncée, si le transporteur le permet. */
  async cancelShipment(shipmentId: string): Promise<void> {
    await this.request("POST", `/shipments/${encodeURIComponent(shipmentId)}/cancel`)
  }

  /** Points relais d'une zone, pour le sélecteur du tunnel de commande. */
  async listServicePoints(input: {
    country: string
    carriers?: string[]
    postalCode?: string
    city?: string
    latitude?: string
    longitude?: string
    radius?: number
  }): Promise<SendcloudServicePoint[]> {
    const params = new URLSearchParams({ country: input.country })

    if (input.carriers?.length) params.set("carrier", input.carriers.join(","))
    if (input.postalCode) params.set("postal_code", input.postalCode)
    if (input.city) params.set("city", input.city)
    if (input.latitude) params.set("latitude", input.latitude)
    if (input.longitude) params.set("longitude", input.longitude)
    if (input.radius) params.set("radius", String(input.radius))

    const body = await this.request<SendcloudServicePoint[] | { data?: SendcloudServicePoint[] }>(
      "GET",
      `/service-points?${params.toString()}`
    )

    return Array.isArray(body) ? body : body.data ?? []
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
