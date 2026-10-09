import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { optionsRetrait } from "../../../lib/retrait-boutique"

/**
 * GET /store/retrait-boutique — les options de retrait et l'adresse de leur boutique.
 *
 * Une commande ne dit pas d'elle-même qu'elle est un retrait : elle ne porte que
 * l'identifiant de son option. La boutique compare cet identifiant à cette liste pour
 * écrire « Prête à retirer » plutôt que « Expédiée », et afficher l'adresse du comptoir.
 * Rien que de public : l'adresse est celle de la boutique.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const options = await optionsRetrait(req.scope)

  res.json({
    options: [...options.entries()].map(([id, lieu]) => ({ id, lieu })),
  })
}
