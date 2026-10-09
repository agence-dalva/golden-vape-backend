export type ResendOptions = {
  /** Clé API Resend. Vide, rien ne part : les emails sont rendus et journalisés. */
  apiKey?: string
  /** Expéditeur, au format « Golden Vape <commandes@golden-vape.fr> ». */
  from: string
  /** Base des liens vers la boutique — suivi de commande, réinitialisation. */
  storefrontUrl: string
  /** Adresse de réponse, si différente de l'expéditeur. */
  replyTo?: string
  /**
   * Boîte de test Mailtrap. Renseignée, TOUS les emails y partent à la place de Resend :
   * c'est le réglage pour relire les templates dans une vraie messagerie sans écrire à
   * personne.
   */
  mailtrap?: { token: string; inboxId: string }
}
