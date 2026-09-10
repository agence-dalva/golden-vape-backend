/**
 * Types de l'API Sendcloud v3.
 *
 * Volontairement limités à ce qu'on exploite : la spec complète couvre les douanes, les
 * retours et le multicollo, qu'on n'utilise pas encore. Les noms suivent ceux de l'API,
 * en snake_case, pour qu'une réponse se lise sans traduction mentale.
 */

export type SendcloudOptions = {
  publicKey: string
  secretKey: string
  /**
   * Secret de vérification des webhooks. Sendcloud signe avec la clé secrète de
   * l'intégration, qui peut différer de la clé d'API selon le type d'intégration —
   * d'où une variable distincte, qui retombe sur `secretKey` si elle n'est pas fournie.
   */
  webhookSecret: string
  /**
   * Certaines intégrations sont configurées pour *exiger* OAuth2 : l'authentification
   * Basic y échoue. Le jeton vit une heure et se met en cache.
   */
  useOAuth: boolean
  /** Adresse d'expédition. Absente, Sendcloud reprend celle par défaut du compte. */
  senderAddressId?: number
  /** Pays de départ, qui sert aussi de référence pour énumérer les options. */
  defaultCountryCode?: string
  /**
   * Poids de repli, en grammes, quand aucun article ne porte de poids.
   *
   * Laissé vide, l'affranchissement échoue plutôt que de déclarer une valeur au hasard :
   * un colis sous-évalué est repesé par le transporteur, puis refacturé.
   */
  fallbackParcelWeightGrams?: number
}

/** Poids et dimensions, tels que l'API les attend — valeurs en chaînes, unité explicite. */
export type SendcloudWeight = { value: string; unit: "kg" | "g" }
export type SendcloudDimensions = {
  length: string
  width: string
  height: string
  unit: "cm" | "m" | "in"
}

export type SendcloudAddress = {
  name: string
  company_name?: string
  address_line_1: string
  address_line_2?: string
  house_number?: string
  postal_code: string
  city: string
  country_code: string
  phone_number?: string
  email?: string
}

export type SendcloudParcel = {
  weight: SendcloudWeight
  dimensions?: SendcloudDimensions
  parcel_items?: SendcloudParcelItem[]
}

export type SendcloudParcelItem = {
  item_id?: string
  description: string
  quantity: number
  weight: SendcloudWeight
  price: { value: string; currency: string }
}

/**
 * Désignation du service d'expédition. `shipping_option_code` est le code rendu par
 * `/shipping-options` — par exemple `colissimo:standard`. `contract_id` ne sert que si
 * plusieurs contrats coexistent pour un même transporteur.
 */
export type SendcloudShipWith = {
  type: "shipping_option_code"
  properties: { shipping_option_code: string; contract_id?: number }
}

/** Point relais choisi. `carrier_service_point_id` prime si les deux sont fournis. */
export type SendcloudServicePointRef = {
  id?: number
  carrier_service_point_id?: string
  post_number?: string
}

export type AnnounceShipmentRequest = {
  label_details?: { mime_type: string; dpi?: number }
  to_address: SendcloudAddress
  from_address?: SendcloudAddress
  to_service_point?: SendcloudServicePointRef
  ship_with: SendcloudShipWith
  order_number?: string
  total_order_price?: { currency: string; value: string }
  parcels: SendcloudParcel[]
}

export type SendcloudShippingOption = {
  code: string
  carrier: { code: string; name?: string }
  product: { code: string; name: string }
  /** `last_mile` vaut `home_delivery` ou `service_point`. */
  functionalities?: { last_mile?: string; [key: string]: unknown }
  /** Seul champ qui fasse foi pour exiger un point relais a la commande. */
  is_service_point_required?: boolean
  quotes?: {
    price: { total: { value: string; currency: string } }
  }[]
  contract?: { id: number }
}

export type SendcloudServicePoint = {
  id: number
  code?: string
  name: string
  street: string
  house_number: string
  postal_code: string
  city: string
  country: string
  latitude?: string
  longitude?: string
  distance?: number
  carrier: string
  formatted_opening_times?: Record<string, string[]>
}
