import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../modules/product-attribute/service"

// GET /admin/attribute-types/:id
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const attributeType: any = await service.retrieveAttributeType(req.params.id)

  const images = await service.listAttributeValueImages({ attribute_type_id: req.params.id })
  const preset_value_images: Record<string, string> = {}
  for (const img of images as any[]) preset_value_images[img.value] = img.image_url

  const assignments = await service.listProductAttributeValues({ attribute_type_id: req.params.id })
  const preset_value_counts: Record<string, number> = {}
  for (const a of assignments as any[]) preset_value_counts[a.value] = (preset_value_counts[a.value] ?? 0) + 1

  res.json({ attribute_type: { ...attributeType, preset_value_images, preset_value_counts } })
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
