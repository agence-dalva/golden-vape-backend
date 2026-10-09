import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ordonnerBanniereWorkflow } from "../../../../workflows/banniere"
import type { OrdreBanniereType } from "../validators"

// POST /admin/banniere/ordre — { ids } dans l'ordre d'affichage voulu.
export async function POST(req: MedusaRequest<OrdreBanniereType>, res: MedusaResponse) {
  await ordonnerBanniereWorkflow(req.scope).run({ input: { ids: req.validatedBody.ids } })
  res.json({ ok: true })
}
