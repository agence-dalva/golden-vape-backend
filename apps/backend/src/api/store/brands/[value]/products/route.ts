import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../../modules/product-attribute/service"

// GET /store/brands/:value/products — retourne uniquement les product_id d'une marque donnée.
// Le storefront enchaîne avec /store/products?id[]=... pour bénéficier du calcul de prix standard
// (region/country déjà gérés côté storefront), plutôt que de dupliquer cette logique ici.
// :value doit être URL-encodé côté client (ex: "A%26L" pour "A&L").
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { value } = req.params
  const { attribute_type_id } = req.query as { attribute_type_id?: string }

  let typeId = attribute_type_id
  if (!typeId) {
    const [marqueType] = await service.listAttributeTypes({ name: "Marque" })
    if (!marqueType) return res.json({ product_ids: [] })
    typeId = marqueType.id
  }

  const matches = await service.listProductAttributeValues({ attribute_type_id: typeId, value })
  res.json({ product_ids: (matches as any[]).map((m) => m.product_id) })
}
