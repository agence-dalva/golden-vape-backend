import { formatAmount } from "./payment-request"

/** Ce que la session de paiement attend de la notification. */
export type SessionAttendue = {
  id: string
  /** Nombre, texte ou BigNumber de Medusa : converti par `Number`, comme le formulaire. */
  amount: unknown
  currency_code: string
  data?: Record<string, unknown> | null
}

/**
 * Référence transmise à Monetico pour cette session : celle déposée à l'initialisation,
 * à défaut la fin de l'identifiant — la même règle que le formulaire de paiement.
 */
export function referenceAttendue(session: SessionAttendue): string {
  return (session.data?.reference as string | undefined) ?? session.id.slice(-12).toUpperCase()
}

/**
 * Écart entre la notification et la session qu'elle prétend régler, ou `null` si elles
 * concordent. Le sceau garantit que Monetico a bien émis la notification ; il ne garantit
 * pas qu'elle porte sur le montant de cette session. On ne s'en remet donc pas à Medusa,
 * qui recrée aujourd'hui la session quand le total du panier change : le montant payé
 * et la référence doivent être ceux de la session.
 */
export function ecartNotification(
  recu: { montant?: string; reference?: string },
  session: SessionAttendue
): string | null {
  const montant = formatAmount(Number(session.amount), session.currency_code)
  if (recu.montant !== montant) {
    return `montant ${recu.montant ?? "absent"} au lieu de ${montant}`
  }
  const reference = referenceAttendue(session)
  if (recu.reference !== reference) {
    return `référence ${recu.reference ?? "absente"} au lieu de ${reference}`
  }
  return null
}
