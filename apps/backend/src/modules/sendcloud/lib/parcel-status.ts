/**
 * Ce qu'un statut de colis Sendcloud change à la commande.
 *
 * Sendcloud unifie le suivi de tous les transporteurs en une trentaine de statuts
 * (`GET /api/v2/parcels/statuses`). La commande, elle, n'en connaît que trois moments :
 * le colis est parti, il est arrivé, il n'arrivera pas. Tout le reste — tri, tournée,
 * tentative manquée — reste lisible sur la page de suivi du transporteur, sans que la
 * commande change d'état.
 *
 * Les identifiants sont ceux de Sendcloud ; le message ne sert que de repli, au cas où
 * un webhook arriverait sans identifiant.
 */
export type ParcelTransition = "shipped" | "delivered" | "canceled"

/** Le colis est entre les mains du transporteur : premier scan et tout ce qui suit. */
const EN_TRANSIT = new Map<number, string>([
  [3, "En route to sorting center"],
  [4, "Delivery delayed"],
  [5, "Sorted"],
  [6, "Not sorted"],
  [7, "Being sorted"],
  [8, "Delivery attempt failed"],
  [12, "Awaiting customer pickup"],
  [22, "Shipment picked up by driver"],
  [80, "Unable to deliver"],
  [91, "Parcel en route"],
  [92, "Driver en route"],
  [62989, "At Customs"],
  [62990, "At sorting centre"],
  [62991, "Refused by recipient"],
  [62992, "Returned to sender"],
])

/** Remis au destinataire — chez lui, ou retiré au point relais. */
const LIVRE = new Map<number, string>([
  [11, "Delivered"],
  [93, "Shipment collected by customer"],
])

const ANNULE = new Map<number, string>([
  [2000, "Cancelled"],
  [1998, "Cancelled upstream"],
  [1999, "Cancellation requested"],
  [2001, "Submitting cancellation request"],
])

// Les autres statuts — annoncé, prêt à envoyer, étiquette manquante, inconnu, adresse
// invalide… — précèdent le départ ou n'engagent rien : la commande ne bouge pas.

const PAR_MESSAGE = new Map<string, ParcelTransition>()
for (const [groupe, transition] of [
  [EN_TRANSIT, "shipped"],
  [LIVRE, "delivered"],
  [ANNULE, "canceled"],
] as const) {
  for (const message of groupe.values()) {
    PAR_MESSAGE.set(message.toLowerCase(), transition)
  }
}

export function parcelTransition(status: {
  id?: number | null
  message?: string | null
}): ParcelTransition | null {
  const id = status.id ?? undefined

  if (id !== undefined) {
    if (EN_TRANSIT.has(id)) return "shipped"
    if (LIVRE.has(id)) return "delivered"
    if (ANNULE.has(id)) return "canceled"
    return null
  }

  return PAR_MESSAGE.get(status.message?.trim().toLowerCase() ?? "") ?? null
}
