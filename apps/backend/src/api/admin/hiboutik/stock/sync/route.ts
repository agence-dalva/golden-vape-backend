import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lancerSynchronisationStock, SynchronisationEnCours } from "../../../../../modules/hiboutik/lib/stock-sync-runner"

// POST /admin/hiboutik/stock/sync — recopie le stock Hiboutik dans Medusa ; { dryRun: true } pour ne rien écrire
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { dryRun } = (req.body ?? {}) as { dryRun?: boolean }
  try {
    const rapport = await lancerSynchronisationStock(req.scope, { dryRun: !!dryRun, declencheur: "admin" })
    res.json({ rapport })
  } catch (err: any) {
    if (err instanceof SynchronisationEnCours) {
      return res.status(409).json({ message: err.message })
    }
    res.status(500).json({ message: err?.message || "Erreur lors de la synchronisation du stock Hiboutik" })
  }
}
