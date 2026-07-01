import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../../modules/product-attribute/service"

// GET /store/products/:id/attributes — lecture publique des caractéristiques d'un produit
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const values = await service.listProductAttributeValues(
    { product_id: req.params.id },
    { relations: ["attribute_type"] }
  )
  res.json({ attributes: values })
}
