import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import { SendcloudClient } from "./lib/client"
import type {
  SendcloudAddress,
  SendcloudOptions,
  SendcloudParcel,
  SendcloudShippingOption,
} from "./types"

type InjectedDependencies = { logger: Logger }

/** Durée de vie du catalogue d'options. Il ne bouge qu'au gré des contrats du compte. */
const OPTIONS_CACHE_MS = 10 * 60 * 1000

/** Poids de référence pour énumérer les options : sans colis, Sendcloud ne répond rien. */
const REFERENCE_PARCEL: SendcloudParcel = { weight: { value: "1000", unit: "g" } }

/**
 * Provider de fulfillment Sendcloud.
 *
 * Sendcloud sert d'agrégateur : une seule intégration donne Colissimo, Chronopost et les
 * autres transporteurs, points relais compris. Le code ne connaît donc aucun transporteur
 * en particulier — il expose ce que le compte propose, et c'est le choix du contrat chez
 * Sendcloud qui décide du reste.
 */
export default class SendcloudFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "sendcloud"

  protected readonly logger_: Logger
  protected readonly options_: SendcloudOptions
  protected readonly client_: SendcloudClient

  private optionsCache?: { at: number; value: FulfillmentOption[] }

  constructor({ logger }: InjectedDependencies, options: SendcloudOptions) {
    super()

    this.logger_ = logger
    this.options_ = options
    this.client_ = new SendcloudClient(options)
  }

  /**
   * Services proposables au marchand lorsqu'il crée une méthode de livraison.
   *
   * Medusa appelle cette méthode sans contexte : ni destination, ni panier. On interroge
   * donc Sendcloud sur un envoi de référence — France vers France, un kilo — uniquement
   * pour énumérer les services du compte. Les prix réels, eux, sont calculés au panier
   * par `calculatePrice`, avec la vraie destination et le vrai poids.
   *
   * Les deux familles de dernier kilomètre sont interrogées séparément : sans filtre,
   * Sendcloud les mélange et on ne saurait plus laquelle exige un point relais.
   */
  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    if (this.optionsCache && Date.now() - this.optionsCache.at < OPTIONS_CACHE_MS) {
      return this.optionsCache.value
    }

    const country = this.options_.defaultCountryCode ?? "FR"
    const familles = ["home_delivery", "service_point"] as const

    const listes = await Promise.all(
      familles.map((lastMile) =>
        this.client_.listShippingOptions({
          fromCountryCode: country,
          toCountryCode: country,
          parcels: [REFERENCE_PARCEL],
          lastMile,
          calculateQuotes: false,
        })
      )
    )

    const value = listes.flat().map((option) => this.toFulfillmentOption(option))
    this.optionsCache = { at: Date.now(), value }

    return value
  }

  /**
   * Valide les données portées par la méthode de livraison choisie au panier.
   *
   * Le seul contrôle qui compte ici : une livraison en point relais sans point choisi
   * produirait une étiquette sans destination. Mieux vaut refuser au panier qu'échouer
   * à l'affranchissement, une fois le client débité.
   */
  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    if (!optionData?.is_service_point_required) {
      return data
    }

    const servicePointId = data?.service_point_id

    if (!servicePointId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cette livraison se fait en point relais : aucun point n'a été sélectionné."
      )
    }

    return data
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return typeof data?.shipping_option_code === "string"
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  /**
   * Prix réel de la méthode de livraison, pour la destination et le poids du panier.
   *
   * Les tarifs Sendcloud s'entendent hors taxes, comme les prix du catalogue : Medusa
   * applique la TVA de la région par-dessus.
   */
  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const code = (optionData as { shipping_option_code?: string })?.shipping_option_code

    if (!code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "La méthode de livraison ne porte pas de code d'option Sendcloud."
      )
    }

    // Le type générique de Medusa ne reflète pas la forme réelle du contexte : il porte
    // l'adresse de livraison et les articles du panier, dont on a besoin ici.
    const cart = context as unknown as CartLikeContext
    const destination = cart?.shipping_address

    // Le tunnel propose les modes de livraison avant de demander l'adresse : sans elle, on
    // annonce le tarif du pays de depart, qui est celui de la quasi-totalite des paniers.
    // Le prix est recalcule des que l'adresse est connue, et c'est celui-la qui engage.
    const paysDepart = this.options_.defaultCountryCode ?? "FR"
    const paysDestination = destination?.country_code?.toUpperCase() ?? paysDepart

    const options = await this.client_.listShippingOptions({
      fromCountryCode: paysDepart,
      toCountryCode: paysDestination,
      toPostalCode: destination?.postal_code ?? undefined,
      parcels: [{ weight: { value: String(this.cartWeightGrams(cart)), unit: "g" } }],
      calculateQuotes: true,
      toServicePoint: (data as { service_point_id?: number })?.service_point_id
        ? { id: Number((data as { service_point_id: number }).service_point_id) }
        : undefined,
    })

    const retenue = options.find((option) => option.code === code)
    const montant = retenue?.quotes?.[0]?.price?.total?.value

    if (montant === undefined) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Sendcloud ne propose pas « ${code} » pour cette destination et ce poids.`
      )
    }

    // Franchise de port. Elle est appliquee ici plutot que par une promotion Medusa :
    // ses regles n'acceptent que des attributs de produit, de client ou de pays, jamais
    // un montant de panier. Le prix rendu par le provider fait foi, le total suit, et
    // aucune constante n'a besoin d'exister dans l'interface.
    if (this.franchiseAtteinte(cart)) {
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
    }

    return {
      calculated_amount: Number(montant),
      is_calculated_price_tax_inclusive: false,
    }
  }

  /**
   * Crée l'expédition chez Sendcloud et rend l'étiquette.
   *
   * La variante synchrone attend le transporteur : la réponse porte le numéro de suivi
   * et l'étiquette, que Medusa enregistre en `FulfillmentLabel` sans qu'on ait à stocker
   * quoi que ce soit nous-mêmes.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const code = (data as { shipping_option_code?: string })?.shipping_option_code

    if (!code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Impossible d'affranchir : la méthode de livraison ne porte pas de code Sendcloud."
      )
    }

    const destinataire = toSendcloudAddress(order)

    if (!destinataire) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Une adresse de livraison complète est nécessaire pour affranchir ce colis."
      )
    }

    const reponse = await this.client_.announceShipment({
      label_details: { mime_type: "application/pdf" },
      to_address: destinataire,
      to_service_point: (data as { service_point_id?: number })?.service_point_id
        ? { id: Number((data as { service_point_id: number }).service_point_id) }
        : undefined,
      ship_with: { type: "shipping_option_code", properties: { shipping_option_code: code } },
      order_number: (order as { display_id?: number })?.display_id?.toString(),
      parcels: [
        {
          weight: {
            value: String(this.fulfillmentWeightGrams(data, items, order)),
            unit: "g",
          },
        },
      ],
    })

    this.logger_.info(
      `Sendcloud : expédition créée pour la commande ${(order as { display_id?: number })?.display_id ?? "?"}.`
    )

    // `fulfillment` n'expose pas `data` — Medusa l'exclut de la signature. On repart donc
    // des donnees de la methode de livraison, en y joignant la reponse de Sendcloud : le
    // code d'option et le point relais restent ainsi attaches au fulfillment, et
    // l'annulation y retrouve l'identifiant de l'expedition.
    return {
      data: { ...data, sendcloud: reponse },
      labels: extractLabels(reponse),
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const shipmentId = (data as { sendcloud?: { id?: string } })?.sendcloud?.id

    if (!shipmentId) {
      // Rien à annuler chez Sendcloud : l'expédition n'a jamais été annoncée.
      return {}
    }

    await this.client_.cancelShipment(shipmentId)

    return {}
  }

  /** Le panier atteint-il le montant qui offre la livraison ? */
  private franchiseAtteinte(cart: CartLikeContext): boolean {
    const seuil = this.options_.freeShippingFromSubtotal

    if (!seuil || seuil <= 0) {
      return false
    }

    const sousTotal = (cart?.items ?? []).reduce((somme, item) => {
      const prix = Number(item?.unit_price ?? 0)
      return somme + (Number.isFinite(prix) ? prix : 0) * Number(item?.quantity ?? 0)
    }, 0)

    return sousTotal >= seuil
  }

  private toFulfillmentOption(option: SendcloudShippingOption): FulfillmentOption {
    const transporteur = option.carrier?.code

    return {
      id: option.code,
      name: `${option.carrier?.name ?? transporteur ?? "?"} — ${option.product?.name ?? option.code}`,
      shipping_option_code: option.code,
      carrier_code: transporteur,
      carrier_name: option.carrier?.name ?? transporteur ?? null,
      /** Nom commercial du service — « Chrono Shop2Shop », « Colissimo Home ». */
      product_name: option.product?.name ?? null,
      /**
       * Logo du transporteur, servi par le CDN de Sendcloud.
       *
       * L'endpoint des options ne le rend pas, contrairement a celui des points relais :
       * l'URL est donc reconstruite sur le motif que ce dernier expose. Verifie pour
       * Colissimo et Chronopost. Le tunnel retombe sur le nom si l'image ne charge pas —
       * un motif non documente peut changer sans preavis.
       */
      carrier_logo_url: transporteur
        ? `https://cdn.sendcloud.com/global-media/${transporteur}/img/logo.svg`
        : null,
      /** Variante carree du logo, mieux adaptee a une pastille qu'un logotype allonge. */
      carrier_icon_url: transporteur
        ? `https://cdn.sendcloud.com/global-media/${transporteur}/img/icon.svg`
        : null,
      is_service_point_required: exigeUnPointRelais(option),
      free_shipping_from_subtotal: this.options_.freeShippingFromSubtotal ?? null,
    }
  }

  /** Poids total du panier, en grammes. */
  private cartWeightGrams(cart: CartLikeContext): number {
    const total = (cart?.items ?? []).reduce((somme, item) => {
      const unitaire = item?.variant?.weight
      return somme + (typeof unitaire === "number" ? unitaire : 0) * (item?.quantity ?? 0)
    }, 0)

    return total > 0 ? total : this.options_.fallbackParcelWeightGrams ?? 0
  }

  /**
   * Poids du colis à affranchir, en grammes.
   *
   * Trois sources, par ordre de priorité : la saisie manuelle du marchand au moment de
   * l'expédition, la somme des poids de variantes, puis le repli configuré. Aucun poids
   * du tout fait échouer l'affranchissement plutôt que de déclarer une valeur au hasard :
   * un poids sous-évalué est repesé en centre de tri et refacturé.
   */
  private fulfillmentWeightGrams(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined
  ): number {
    const manuel = (data as { weight_grams?: number })?.weight_grams

    if (typeof manuel === "number" && manuel > 0) {
      return manuel
    }

    const parLigne = new Map<string, number>()
    for (const ligne of (order as unknown as CartLikeContext)?.items ?? []) {
      if (ligne?.id && typeof ligne.variant?.weight === "number") {
        parLigne.set(ligne.id, ligne.variant.weight)
      }
    }

    const total = items.reduce((somme, item) => {
      const unitaire = parLigne.get(item?.line_item_id ?? "") ?? 0
      return somme + unitaire * Number(item?.quantity ?? 0)
    }, 0)

    if (total > 0) {
      return total
    }

    const repli = this.options_.fallbackParcelWeightGrams

    if (repli && repli > 0) {
      this.logger_.warn(
        "Sendcloud : aucun poids sur les articles, repli sur le poids par défaut configuré."
      )
      return repli
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Aucun poids connu pour ce colis : renseigner le poids des variantes, saisir un poids manuel, ou configurer SENDCLOUD_FALLBACK_WEIGHT_GRAMS."
    )
  }
}

/**
 * Ce service impose-t-il de désigner un point de retrait ?
 *
 * `is_service_point_required` figure dans la documentation mais pas dans les réponses
 * réelles : c'est `functionalities.last_mile` qui tranche, et il prend trois valeurs —
 * `home_delivery`, `service_point`, et `locker_or_service_point` pour les offres qui
 * mêlent commerces et consignes automatiques, comme le retrait Colissimo. Une comparaison
 * stricte à `service_point` laisserait donc passer cette derniere sans selecteur, et
 * l'affranchissement echouerait faute de destination.
 */
function exigeUnPointRelais(option: SendcloudShippingOption): boolean {
  if (typeof option.is_service_point_required === "boolean") {
    return option.is_service_point_required
  }

  return Boolean(option.functionalities?.last_mile?.includes("service_point"))
}

/** Forme réelle du contexte de panier, que les types génériques de Medusa n'exposent pas. */
type CartLikeContext = {
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    country_code?: string | null
    phone?: string | null
  } | null
  email?: string | null
  items?: {
    id?: string
    quantity?: number
    /** Hors taxes : c'est l'unite dans laquelle Medusa transmet les prix de ligne. */
    unit_price?: number | string | null
    variant?: { weight?: number | null } | null
  }[]
}

function toSendcloudAddress(order: Partial<FulfillmentOrderDTO> | undefined): SendcloudAddress | null {
  const source = (order as unknown as CartLikeContext)?.shipping_address

  if (!source?.address_1 || !source.city || !source.postal_code || !source.country_code) {
    return null
  }

  const nom = [source.first_name, source.last_name].filter(Boolean).join(" ").trim()

  return {
    name: nom || "Client",
    company_name: source.company ?? undefined,
    address_line_1: source.address_1,
    address_line_2: source.address_2 ?? undefined,
    postal_code: source.postal_code,
    city: source.city,
    country_code: source.country_code.toUpperCase(),
    phone_number: source.phone ?? undefined,
    email: (order as unknown as CartLikeContext)?.email ?? undefined,
  }
}

/**
 * Ramène les colis de la réponse Sendcloud à la forme attendue par Medusa.
 *
 * Une expédition peut porter plusieurs colis ; chacun a son numéro de suivi et son
 * étiquette, et Medusa en fait autant de `FulfillmentLabel`.
 */
function extractLabels(reponse: Record<string, unknown>): CreateFulfillmentResult["labels"] {
  const donnees = (reponse?.data ?? reponse) as {
    parcels?: {
      tracking_number?: string
      tracking_url?: string
      label?: { normal_printer?: string[]; label_url?: string }
    }[]
  }

  return (donnees?.parcels ?? []).map((colis) => ({
    tracking_number: colis?.tracking_number ?? "",
    tracking_url: colis?.tracking_url ?? "",
    label_url: colis?.label?.label_url ?? colis?.label?.normal_printer?.[0] ?? "",
  }))
}
