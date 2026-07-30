import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHiboutikProductsWorkflow } from "../../../../../workflows/sync-hiboutik-products"
import { clearCachedPreview } from "../../../../../modules/hiboutik/preview-cache"

// POST /admin/hiboutik/sync/create — crée dans Medusa les produits Hiboutik fournis (issus de /preview)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { missing } = req.body as { missing?: unknown }

  if (!Array.isArray(missing) || missing.length === 0) {
    return res.status(400).json({ message: "Le champ 'missing' doit être un tableau non vide" })
  }

  try {
    const { result } = await createHiboutikProductsWorkflow(req.scope).run({
      input: missing as any,
    })
    clearCachedPreview()
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Erreur lors de la création des produits Hiboutik" })
  }
}
