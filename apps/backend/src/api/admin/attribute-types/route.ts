import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../modules/product-attribute/service"

// GET /admin/attribute-types — liste tous les types d'attributs
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const attributeTypes = await service.listAttributeTypes({}, { order: { name: "ASC" } })
  const typeIds = attributeTypes.map((t: any) => t.id)

  // Attache les images de valeurs prédéfinies (value -> image_url) à chaque type,
  // pour éviter le N+1 côté admin UI
  const images = await service.listAttributeValueImages({ attribute_type_id: typeIds })
  const imagesByType = new Map<string, Record<string, string>>()
  for (const img of images as any[]) {
    if (!imagesByType.has(img.attribute_type_id)) imagesByType.set(img.attribute_type_id, {})
    imagesByType.get(img.attribute_type_id)![img.value] = img.image_url
  }

  // Attache le nombre de produits par valeur (value -> count), en une seule requête batchée
  // plutôt qu'un round-trip par type — utilisé par la page admin "Marques" pour afficher
  // combien de produits sont tagués sur chaque marque.
  const assignments = await service.listProductAttributeValues({ attribute_type_id: typeIds })
  const countsByType = new Map<string, Record<string, number>>()
  for (const a of assignments as any[]) {
    if (!countsByType.has(a.attribute_type_id)) countsByType.set(a.attribute_type_id, {})
    const counts = countsByType.get(a.attribute_type_id)!
    counts[a.value] = (counts[a.value] ?? 0) + 1
  }

  const enriched = attributeTypes.map((t: any) => ({
    ...t,
    preset_value_images: imagesByType.get(t.id) ?? {},
    preset_value_counts: countsByType.get(t.id) ?? {},
  }))

  res.json({ attribute_types: enriched })
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
