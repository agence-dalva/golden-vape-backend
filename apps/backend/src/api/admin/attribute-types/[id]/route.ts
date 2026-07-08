import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../modules/product-attribute/service"

// GET /admin/attribute-types/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const attributeType = await service.retrieveAttributeType(req.params.id)
  res.json({ attribute_type: attributeType })
}

// PUT /admin/attribute-types/:id — met à jour nom et/ou valeurs prédéfinies
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { name, preset_values, allow_multiple } = req.body as any
  const attributeType = await service.updateAttributeTypes({
    id: req.params.id,
    ...(name !== undefined && { name }),
    ...(preset_values !== undefined && { preset_values }),
    ...(allow_multiple !== undefined && { allow_multiple }),
  })
  res.json({ attribute_type: attributeType })
}

// DELETE /admin/attribute-types/:id
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  await service.deleteAttributeTypes(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
