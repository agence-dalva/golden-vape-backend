import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../modules/product-attribute/service"

// GET /store/brands — liste publique des valeurs de "Marque" ayant une image uploadée
// Optionnel: ?attribute_type_id=xxx pour cibler un autre type que "Marque"
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { attribute_type_id } = req.query as { attribute_type_id?: string }

  let typeId = attribute_type_id
  if (!typeId) {
    const [marqueType] = await service.listAttributeTypes({ name: "Marque" })
    if (!marqueType) return res.json({ brands: [] })
    typeId = marqueType.id
  }

  const images = await service.listAttributeValueImages(
    { attribute_type_id: typeId },
    { order: { value: "ASC" } }
  )

  const brands = (images as any[]).map((img) => ({
    value: img.value,
    image_url: img.image_url,
    attribute_type_id: typeId,
  }))

  res.json({ brands })
}
