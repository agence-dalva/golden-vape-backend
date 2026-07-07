import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { previewHiboutikSyncWorkflow } from "../../../../../workflows/sync-hiboutik-products"
import { getCachedPreview, setCachedPreview } from "../../../../../modules/hiboutik/preview-cache"

// POST /admin/hiboutik/sync/preview — liste les produits Hiboutik absents de Medusa, sans rien créer
// Le résultat est mis en cache 30 min (le catalogue Hiboutik change peu) ; ?force=true pour l'ignorer.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const force = req.query.force === "true"

  if (!force) {
    const cached = getCachedPreview()
    if (cached) return res.json({ ...cached, cached: true })
  }

  try {
    const { result } = await previewHiboutikSyncWorkflow(req.scope).run()
    setCachedPreview(result)
    res.json({ ...result, cached: false })
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Erreur lors de la prévisualisation Hiboutik" })
  }
}
