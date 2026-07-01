import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../modules/product-attribute/service"

// GET /admin/attribute-types — liste tous les types d'attributs
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const attributeTypes = await service.listAttributeTypes({}, { order: { name: "ASC" } })
  res.json({ attribute_types: attributeTypes })
}

// POST /admin/attribute-types — crée un nouveau type d'attribut
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { name, preset_values = [], allow_multiple = false } = req.body as any

  if (!name) {
    return res.status(400).json({ message: "name is required" })
  }

  const attributeType = await service.createAttributeTypes({ name, preset_values, allow_multiple })
  res.status(201).json({ attribute_type: attributeType })
}
