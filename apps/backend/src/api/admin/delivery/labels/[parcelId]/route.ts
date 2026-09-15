import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SendcloudClient } from "../../../../../modules/sendcloud/lib/client"
import { sendcloudOptionsFromEnv } from "../../../../../modules/sendcloud/lib/options"

/**
 * Étiquette d'un colis Sendcloud, servie au marchand.
 *
 * C'est le lien que Medusa affiche sur l'expédition, dans la commande. Sendcloud ne livre
 * ses documents que derrière l'authentification API — un lien direct s'ouvrirait sur un
 * 401 — donc ce backend va la chercher avec les clés et la renvoie telle quelle. La route
 * est sous `/admin`, Medusa y exige une session d'administration : l'étiquette, qui porte
 * le nom et l'adresse du client, ne sort pas du back-office.
 *
 *   GET /admin/delivery/labels/:parcelId              → PDF, ouvert dans l'onglet
 *   GET /admin/delivery/labels/:parcelId?format=zpl   → pour une imprimante thermique
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const parcelId = Number(req.params.parcelId)

  if (!Number.isInteger(parcelId) || parcelId <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Identifiant de colis invalide.")
  }

  const options = sendcloudOptionsFromEnv()

  if (!options.publicKey || !options.secretKey) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Sendcloud n'est pas configuré.")
  }

  const format = (req.query as { format?: string }).format === "zpl" ? "application/zpl" : "application/pdf"
  const document = await new SendcloudClient(options).downloadParcelDocument(parcelId, "label", format)

  res.setHeader("content-type", document.contentType)
  res.setHeader(
    "content-disposition",
    `inline; filename="etiquette-${parcelId}.${format === "application/zpl" ? "zpl" : "pdf"}"`
  )
  // Le document ne change pas, mais il est nominatif : pas de cache partagé.
  res.setHeader("cache-control", "private, no-store")
  res.status(200).send(document.body)
}
