import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../modules/product-attribute/service"

// preset_values is stored as comma-separated text; these helpers bridge to string[]
function serialize(arr: string[]): string { return arr.filter(Boolean).join(",") }
function deserialize(raw: string): string[] { return raw ? raw.split(",").filter(Boolean) : [] }
function deserializeType(t: any) { return { ...t, preset_values: deserialize(t.preset_values ?? "") } }

// GET /admin/attribute-types — liste tous les types d'attributs
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const attributeTypes = await service.listAttributeTypes({}, { order: { name: "ASC" } })
  res.json({ attribute_types: attributeTypes.map(deserializeType) })
}

// POST /admin/attribute-types — crée un nouveau type d'attribut
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { name, preset_values = [], allow_multiple = false } = req.body as any

  if (!name) {
    return res.status(400).json({ message: "name is required" })
  }

  const attributeType = await service.createAttributeTypes({ name, preset_values: serialize(preset_values), allow_multiple })
  res.status(201).json({ attribute_type: deserializeType(attributeType) })
}
