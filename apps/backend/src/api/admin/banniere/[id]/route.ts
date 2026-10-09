import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { supprimerImageBanniereWorkflow } from "../../../../workflows/banniere"

// DELETE /admin/banniere/:id — retire l'image de la bannière et supprime son fichier.
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await supprimerImageBanniereWorkflow(req.scope).run({ input: { id: req.params.id } })
  res.json({ id: req.params.id, deleted: true })
}
