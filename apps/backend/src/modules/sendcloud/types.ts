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
  /**
   * Adresse d'expédition, par son identifiant chez Sendcloud.
   *
   * L'API v3 exige `from_address` à l'annonce et n'applique pas l'adresse « par défaut »
   * du panel. Non configurée, le provider prend la seule adresse du compte ; il n'en
   * faut qu'une de plus pour que la variable devienne obligatoire.
   */
  senderAddressId?: number
  /**
   * URL publique de ce backend, base des liens d'étiquette rendus à Medusa.
   *
   * Sendcloud ne livre l'étiquette que derrière l'authentification API : son lien ne
   * s'ouvre pas depuis un navigateur. Le provider rend donc un lien vers une route
   * d'administration de ce backend, qui va la chercher avec les clés et la sert au
   * marchand connecté.
   */
  backendUrl?: string
  /** Pays de départ, qui sert aussi de référence pour énumérer les options. */
  defaultCountryCode?: string
  /**
   * Poids de repli, en grammes, quand aucun article ne porte de poids.
   *
   * Laissé vide, l'affranchissement échoue plutôt que de déclarer une valeur au hasard :
   * un colis sous-évalué est repesé par le transporteur, puis refacturé.
   */
  fallbackParcelWeightGrams?: number
  /**
   * Montant hors taxes du panier a partir duquel la livraison est offerte.
   *
   * Exprime en HT parce que c'est l'unite que le provider voit : les prix de ligne que
   * Medusa lui transmet sont hors taxes. A 20 %, 50 € HT correspondent aux 60 € TTC
   * annonces au client.
   *
   * Non defini, aucune franchise n'est appliquee.
   */
  freeShippingFromSubtotal?: number
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

/** Adresse d'expédition : préenregistrée chez Sendcloud, ou donnée en entier. */
export type SendcloudFromAddress = { sender_address_id: number } | SendcloudAddress

/** Adresse d'expédition enregistrée dans le compte (Réglages → Adresses du panel). */
export type SendcloudSenderAddress = SendcloudAddress & {
  id: number
  address_line_2?: string | null
  po_box?: string | null
}

export type AnnounceShipmentRequest = {
  label_details?: { mime_type: string; dpi?: number }
  to_address: SendcloudAddress
  from_address: SendcloudFromAddress
  to_service_point?: SendcloudServicePointRef
  ship_with: SendcloudShipWith
  order_number?: string
  total_order_price?: { currency: string; value: string }
  parcels: SendcloudParcel[]
}

/** Document attaché à un colis. Le lien exige l'authentification API. */
export type SendcloudParcelDocument = {
  type: "label" | "cn23" | "cp71" | "commercial-invoice" | "cn23-default" | "air-waybill" | "qr"
  document_type?: "label" | "customs-declaration" | "air-waybill"
  size?: "a6" | "a4"
  link: string
}

/** Colis tel que l'annonce synchrone le rend, une fois le transporteur passé. */
export type SendcloudAnnouncedParcel = {
  id: number
  tracking_number?: string | null
  tracking_url?: string | null
  status?: { code?: string; message?: string }
  documents?: SendcloudParcelDocument[]
  /** PDF en base64 — présent seulement quand l'expédition n'a qu'un colis. */
  label_file?: string | null
}

/** Corps de `data` dans la réponse de `POST /shipments/announce`. */
export type SendcloudShipment = {
  id: string
  order_number?: string | null
  parcels?: SendcloudAnnouncedParcel[]
  [key: string]: unknown
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
  name: string
  /** Le CDN Sendcloud fournit logo et icône : rien à héberger côté front. */
  carrier: { code: string; name: string; logo_url?: string; icon_url?: string }
  /** Identifiant du point chez le transporteur — c'est lui qui part à l'affranchissement. */
  carrier_service_point_id: string
  carrier_shop_type?: string
  /** Catégorie normalisée entre transporteurs : `post_office`, `shop`… */
  general_shop_type?: string
  address: {
    street: string
    house_number: string
    postal_code: string
    city: string
    country_code: string
  }
  position?: { latitude: number; longitude: number }
  contact?: { email?: string; phone?: string }
  /** Créneaux par jour ; `null` signifie fermé. */
  opening_times?: Record<string, { start_time: string; end_time: string }[] | null>
  /** Distance au point de recherche, en mètres. */
  distance?: number
  is_open_tomorrow?: boolean
  /** Prochaine ouverture, quand le point est ferme a l'instant. */
  next_open_at?: string | null
}

/**
 * Réponse de la recherche de points relais.
 *
 * `geocoding` rend le point de référence effectivement retenu par Sendcloud à partir de
 * l'adresse fournie : c'est sur lui qu'il faut centrer la carte, et non sur une position
 * devinée côté client.
 */
export type SendcloudServicePointSearch = {
  results: SendcloudServicePoint[]
  /**
   * Ce que Sendcloud a compris de l'adresse cherchee. Attention : il ne rend ni latitude
   * ni longitude, seulement un statut et une adresse normalisee — le centrage de la carte
   * doit donc venir du cadrage sur les points trouves.
   */
  geocoding?: { status?: string; precision?: string; formatted_address?: string }
}

/** Contrat transporteur rattaché au compte Sendcloud. */
export type SendcloudContract = {
  id: number
  carrier: { code?: string; name?: string } | string
  client_id?: string
  is_active?: boolean
}
