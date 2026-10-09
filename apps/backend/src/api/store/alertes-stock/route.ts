import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { disponibilites } from "../../../lib/alertes-stock"
import { ALERTE_STOCK_MODULE } from "../../../modules/alerte-stock"
import type AlerteStockModuleService from "../../../modules/alerte-stock/service"
import { creerAlerteStockWorkflow } from "../../../workflows/creer-alerte-stock"
import type { CreerAlerteStockType } from "./validators"

// Garde-fou contre le remplissage par un robot : un client réel n'attend pas autant
// d'articles à la fois.
const DEMANDES_MAX_PAR_ADRESSE = 30

/**
 * POST /store/alertes-stock — « prévenez-moi du retour en stock ».
 *
 * Redemander la même déclinaison ne crée rien de plus et répond pareil : la réponse ne dit
 * pas si l'adresse était déjà connue.
 */
export async function POST(req: MedusaRequest<CreerAlerteStockType>, res: MedusaResponse) {
  const { email, variant_id } = req.validatedBody
  const alertes = req.scope.resolve<AlerteStockModuleService>(ALERTE_STOCK_MODULE)

  const etat = (await disponibilites(req.scope, [variant_id])).get(variant_id)
  if (!etat) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Article introuvable.")
  }

  // Revenu en stock entre l'affichage de la page et l'envoi du formulaire.
  if (etat.disponible) {
    return res.json({ disponible: true })
  }

  const enAttente = await alertes.listAlerteStocks({ email, notified_at: null }, { take: DEMANDES_MAX_PAR_ADRESSE + 1 })

  if (!enAttente.some((a) => a.variant_id === variant_id)) {
    if (enAttente.length >= DEMANDES_MAX_PAR_ADRESSE) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Trop de demandes en attente pour cette adresse.")
    }
    await creerAlerteStockWorkflow(req.scope).run({ input: { email, variant_id } })
  }

  res.json({ disponible: false, enregistree: true })
}
