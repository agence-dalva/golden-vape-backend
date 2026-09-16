import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lireDernierRapport } from "../../../../../modules/hiboutik/lib/rapport-stock"

// GET /admin/hiboutik/stock/last — le dernier rapport de synchronisation, quel qu'en soit le déclencheur
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ rapport: await lireDernierRapport(req.scope) })
}
