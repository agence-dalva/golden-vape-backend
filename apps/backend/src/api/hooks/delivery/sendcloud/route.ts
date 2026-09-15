import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import { sendcloudOptionsFromEnv } from "../../../../modules/sendcloud/lib/options"
import { parcelTransition } from "../../../../modules/sendcloud/lib/parcel-status"
import { verifyWebhookSignature } from "../../../../modules/sendcloud/lib/signature"

/**
 * Webhook Sendcloud : le suivi du colis fait avancer la commande.
 *
 * Sendcloud lit le suivi chez le transporteur et nous pousse chaque changement de statut.
 * Le numéro de suivi est la clé : c'est celui que l'étiquette a donné à l'expédition
 * Medusa. Premier scan du transporteur → « expédiée » ; remise au destinataire →
 * « livrée ». Le marchand n'a plus à cliquer, mais il le peut toujours — pour un service
 * sans suivi, la lettre par exemple.
 *
 * L'URL est libre — on la déclare nous-mêmes dans les réglages de l'intégration, ce qui
 * permet de la faire pointer sur un tunnel en développement. Chaque intégration a la
 * sienne, et ne reçoit que les événements de ses propres colis.
 *
 * Les webhooks peuvent arriver dans le désordre après une indisponibilité. On n'en tient
 * pas compte autrement qu'en n'avançant jamais à reculons : une expédition livrée ne
 * repasse pas « expédiée », une expédition expédiée ne l'est pas deux fois. Sendcloud
 * réessaie dix fois en cas d'échec, avec un délai croissant de cinq minutes à une heure :
 * une erreur passagère se rattrape, contrairement à Monetico. On répond donc 200 dès que
 * le message est authentifié et compris, et on laisse échouer bruyamment le reste, pour
 * être rappelé.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
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

  const resume =
    `événement « ${evenement.action ?? "?"} »` +
    (evenement.trackingNumber ? `, colis ${evenement.trackingNumber}` : "") +
    (evenement.status ? `, statut « ${evenement.status} » (${evenement.statusId ?? "sans id"})` : "")

  // Le bouton « Test API Webhook » du panel, la connexion de l'intégration, un retour :
  // rien à faire faire à la commande.
  if (evenement.action !== "parcel_status_changed" || !evenement.trackingNumber) {
    logger.info(`Sendcloud : ${resume}, ignoré.`)
    res.status(200).json({ received: true })
    return
  }

  const transition = parcelTransition({ id: evenement.statusId, message: evenement.status })

  if (!transition) {
    logger.info(`Sendcloud : ${resume}, sans effet sur la commande.`)
    res.status(200).json({ received: true })
    return
  }

  const expedition = await trouverExpedition(req, evenement.trackingNumber)

  // Un colis créé dans le panel, ou d'une autre boutique sur le même compte : pas à nous.
  if (!expedition) {
    logger.warn(`Sendcloud : ${resume}, aucune expédition Medusa ne porte ce numéro de suivi.`)
    res.status(200).json({ received: true })
    return
  }

  const commande = `commande ${expedition.order?.display_id ?? "?"}`

  if (expedition.canceled_at) {
    logger.info(`Sendcloud : ${resume}, expédition déjà annulée dans Medusa (${commande}).`)
    res.status(200).json({ received: true })
    return
  }

  if (transition === "canceled") {
    // Annuler ici appellerait notre provider, qui redemanderait à Sendcloud une annulation
    // déjà faite. Le marchand tranche dans l'admin : annuler l'expédition, ou en refaire une.
    logger.warn(
      `Sendcloud : ${resume} — colis annulé côté Sendcloud alors que l'expédition Medusa est en cours (${commande}). À régler dans l'admin.`
    )
    res.status(200).json({ received: true })
    return
  }

  if (expedition.delivered_at) {
    logger.info(`Sendcloud : ${resume}, ${commande} déjà livrée.`)
    res.status(200).json({ received: true })
    return
  }

  if (!expedition.shipped_at) {
    await createOrderShipmentWorkflow(req.scope).run({
      input: {
        order_id: expedition.order.id,
        fulfillment_id: expedition.id,
        // Les articles sont ceux de l'expédition ; le workflow les relit lui-même.
        items: [],
        // Les étiquettes, elles, sont *remplacées* par cette liste : vide, elle
        // effacerait celle de Sendcloud — et avec elle le numéro de suivi qui relie les
        // webhooks suivants à cette expédition. On renvoie les existantes, comme l'admin.
        labels: expedition.labels,
      },
    })
    logger.info(`Sendcloud : ${commande} expédiée (${evenement.status}).`)
  } else if (transition === "shipped") {
    logger.info(`Sendcloud : ${resume}, ${commande} déjà expédiée.`)
  }

  if (transition === "delivered") {
    await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
      input: { orderId: expedition.order.id, fulfillmentId: expedition.id },
    })
    logger.info(`Sendcloud : ${commande} livrée (${evenement.status}).`)
  }

  res.status(200).json({ received: true })
}

type ExpeditionSuivie = {
  id: string
  shipped_at: string | null
  delivered_at: string | null
  canceled_at: string | null
  labels: { id: string; tracking_number: string; tracking_url: string; label_url: string }[]
  order: { id: string; display_id?: number }
}

/** L'expédition Medusa qui porte ce numéro de suivi, avec sa commande. */
async function trouverExpedition(req: MedusaRequest, trackingNumber: string): Promise<ExpeditionSuivie | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "fulfillment",
    filters: { labels: { tracking_number: trackingNumber } },
    fields: [
      "id",
      "shipped_at",
      "delivered_at",
      "canceled_at",
      "labels.id",
      "labels.tracking_number",
      "labels.tracking_url",
      "labels.label_url",
      "order.id",
      "order.display_id",
    ],
  })

  const expedition = (data as unknown as (ExpeditionSuivie & { order: ExpeditionSuivie["order"] | null })[])[0]

  return expedition?.order?.id ? (expedition as ExpeditionSuivie) : null
}

type EvenementSendcloud = {
  action?: string
  /**
   * Horodatage de l'événement. Les webhooks peuvent arriver dans le désordre après une
   * indisponibilité : c'est lui, et non l'ordre de réception, qui dit lequel est le plus
   * récent. Journalisé ; les transitions n'allant que vers l'avant, il ne décide de rien.
   */
  timestamp?: number
  trackingNumber?: string
  status?: string
  statusId?: number
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
    trackingNumber: colis.tracking_number || undefined,
    status: colis.status?.message,
    statusId: typeof colis.status?.id === "number" ? colis.status.id : undefined,
    parcelId: colis.id,
  }
}
