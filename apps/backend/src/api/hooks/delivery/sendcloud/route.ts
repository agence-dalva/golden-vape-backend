import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendcloudOptionsFromEnv } from "../../../../modules/sendcloud/lib/options"
import { verifyWebhookSignature } from "../../../../modules/sendcloud/lib/signature"

/**
 * Webhook Sendcloud.
 *
 * L'URL est libre — on la déclare nous-mêmes dans les réglages de l'intégration, ce qui
 * permet de la faire pointer sur un tunnel en développement. Chaque intégration a la
 * sienne, et ne reçoit que les événements de ses propres colis.
 *
 * Sendcloud réessaie dix fois en cas d'échec, avec un délai croissant de cinq minutes à
 * une heure : une erreur passagère se rattrape, contrairement à Monetico. On répond donc
 * 200 dès que le message est authentifié et compris, et on laisse échouer bruyamment le
 * reste, pour être rappelé.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const options = sendcloudOptionsFromEnv()

  const signature = req.headers["sendcloud-signature"]
  const recue = Array.isArray(signature) ? signature[0] : signature

  if (!verifyWebhookSignature(req.rawBody as Buffer, options.webhookSecret, recue)) {
    logger.warn("Sendcloud : signature de webhook invalide, message rejeté.")
    res.status(401).json({ message: "Signature invalide." })
    return
  }

  const evenement = lireEvenement(req.rawBody)

  if (!evenement) {
    logger.error("Sendcloud : corps de webhook illisible.")
    res.status(400).json({ message: "Corps illisible." })
    return
  }

  // La documentation v3 ne fige pas l'enveloppe : elle renvoie à « la même charge utile
  // que la lecture d'un colis ». On journalise donc la forme reçue tant qu'on n'a pas
  // confirmé la structure sur un message réel — le bouton « Test API Webhook » du panel
  // en envoie un sans rien expédier.
  logger.info(
    `Sendcloud : événement « ${evenement.action ?? "?"} »` +
      (evenement.trackingNumber ? `, colis ${evenement.trackingNumber}` : "") +
      (evenement.status ? `, statut « ${evenement.status} »` : "") +
      `, horodatage ${evenement.timestamp ?? "absent"}.`
  )

  res.status(200).json({ received: true })
}

type EvenementSendcloud = {
  action?: string
  /**
   * Horodatage de l'événement. Les webhooks peuvent arriver dans le désordre après une
   * indisponibilité : c'est lui, et non l'ordre de réception, qui dit lequel est le plus
   * récent. Indispensable pour ne pas faire repasser un colis livré en « en transit ».
   */
  timestamp?: number
  trackingNumber?: string
  status?: string
  parcelId?: number
}

function lireEvenement(rawBody: unknown): EvenementSendcloud | null {
  const texte = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "")

  let corps: Record<string, unknown>
  try {
    corps = JSON.parse(texte)
  } catch {
    return null
  }

  const colis = (corps.parcel ?? {}) as {
    id?: number
    tracking_number?: string
    status?: { message?: string; id?: number }
  }

  return {
    action: typeof corps.action === "string" ? corps.action : undefined,
    timestamp: typeof corps.timestamp === "number" ? corps.timestamp : undefined,
    trackingNumber: colis.tracking_number,
    status: colis.status?.message,
    parcelId: colis.id,
  }
}
