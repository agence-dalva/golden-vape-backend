import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../modules/product-attribute/service"

// Une grille de catalogue affiche la marque et la caractéristique principale de chaque
// produit. Interroger /store/products/:id/attributes produit par produit ferait vingt-quatre
// allers-retours par page : cette route les lit en une seule requête.
//
// GET /store/product-attributes?product_ids=prod_1,prod_2
// → { attributes: { prod_1: [{ value, type }], … } }

// Au-delà, la chaîne de requête devient déraisonnable et la page qui en a besoin devrait
// paginer plutôt que tout demander d'un coup.
const MAX_IDS = 100

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_ids } = req.query as { product_ids?: string }

  const ids = (product_ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return res.json({ attributes: {} })
  }

  if (ids.length > MAX_IDS) {
    return res.status(400).json({
      type: "invalid_data",
      message: `product_ids accepte au maximum ${MAX_IDS} identifiants`,
    })
  }

  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const values = await service.listProductAttributeValues(
    { product_id: ids },
    { relations: ["attribute_type"] }
  )

  const attributes: Record<string, { value: string; type: string }[]> = {}
  for (const entry of values as { product_id: string; value: string; attribute_type?: { name: string } }[]) {
    if (!entry.attribute_type) continue
    ;(attributes[entry.product_id] ??= []).push({
      value: entry.value,
      type: entry.attribute_type.name,
    })
  }

  res.json({ attributes })
}
