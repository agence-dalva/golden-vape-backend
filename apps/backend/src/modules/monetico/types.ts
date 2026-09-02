// Options du provider, renseignées dans `medusa-config.ts` à partir des variables
// d'environnement. Le TPE, le code société et la clé de sécurité sont fournis par
// Monetico à la création du contrat (back-office « Mon compte / Mes TPE »).
export type MoneticoOptions = {
  /** Numéro du TPE virtuel — 7 caractères alphanumériques. */
  tpe: string
  /** Code société, généré à la création du contrat. */
  societe: string
  /** Clé de sécurité du TPE : 40 caractères hexadécimaux. */
  key: string
  /** `true` pour taper le serveur de validation (« sandbox ») plutôt que la production. */
  sandbox?: boolean
  /** URL de retour navigateur en cas de paiement accepté. */
  urlRetourOk: string
  /** URL de retour navigateur en cas de paiement refusé. */
  urlRetourErr: string
  /** Langue de la page de paiement. Défaut : FR. */
  lgue?: string
  /**
   * Affiche le formulaire minimaliste destiné à être intégré en iframe sur le site
   * marchand plutôt que la page de paiement complète. Nécessite l'option « iframe »
   * souscrite auprès de Monetico.
   */
  iframe?: boolean
  /** Fuseau utilisé pour le champ `date`. Défaut : Europe/Paris. */
  timezone?: string
  /**
   * `true` si le TPE est paramétré en paiement différé ou partiel : la session est
   * alors seulement autorisée, et l'encaissement reste à demander. Par défaut le TPE
   * est en paiement immédiat et Monetico encaisse dès l'autorisation.
   */
  deferredCapture?: boolean
}

/** Document JSON « contexte_commande » — documentation technique v2.0, §9.5. */
export type MoneticoAddress = {
  civility?: string
  firstName?: string
  lastName?: string
  addressLine1: string
  addressLine2?: string
  city: string
  postalCode: string
  country: string
  stateOrProvince?: string
  email?: string
  phone?: string
}

export type MoneticoCartItem = {
  name?: string
  unitPrice: number
  quantity: number
  productSKU?: string
}

export type MoneticoOrderContext = {
  billing: MoneticoAddress
  shipping?: MoneticoAddress
  shoppingCart?: { shoppingCartItems: MoneticoCartItem[] }
  client?: { email?: string; phone?: string }
}

/** Ce que le front doit poster vers Monetico. */
export type MoneticoPaymentForm = {
  actionUrl: string
  fields: Record<string, string>
}
