import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BANNIERE_MODULE } from "../../../modules/banniere"
import type BanniereModuleService from "../../../modules/banniere/service"

/**
 * GET /store/banniere — les images de la bannière d'accueil, dans l'ordre.
 *
 * Liste vide quand rien n'est configuré : la boutique garde alors son visuel par défaut.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const banniere = req.scope.resolve<BanniereModuleService>(BANNIERE_MODULE)
  const images = await banniere.listImageBannieres(
    {},
    { order: { rang: "ASC", created_at: "ASC" }, select: ["id", "url", "largeur", "hauteur"] }
  )
  res.json({ images })
}
