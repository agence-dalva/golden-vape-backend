export type ResendOptions = {
  /** Clé API Resend. Vide, rien ne part : les emails sont rendus et journalisés. */
  apiKey?: string
  /** Expéditeur, au format « Golden Vape <commandes@golden-vape.fr> ». */
  from: string
  /** Base des liens vers la boutique — suivi de commande, réinitialisation. */
  storefrontUrl: string
  /** Adresse de réponse, si différente de l'expéditeur. */
  replyTo?: string
}
