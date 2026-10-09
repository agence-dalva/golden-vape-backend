import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { lieuRetrait, optionsRetrait, statutRetrait } from "../../../../lib/retrait-boutique"

/**
 * GET /admin/retraits-boutique/:orderId — la commande est-elle un retrait, et où en est-il.
 *
 * Lu par le bandeau de la page commande. `retrait: null` pour une commande livrée : le
 * bandeau ne s'affiche pas.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [options, { data: [commande] }] = await Promise.all([
    optionsRetrait(req.scope),
    query.graph({
      entity: "order",
      filters: { id: req.params.orderId },
      fields: [
        "id",
        "shipping_methods.shipping_option_id",
        "fulfillments.canceled_at",
        "fulfillments.delivered_at",
      ],
    }),
  ])

  const lieu = commande ? lieuRetrait(commande.shipping_methods, options) : null

  res.json({
    retrait: lieu ? { lieu, statut: statutRetrait(commande.fulfillments) } : null,
  })
}
