import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../../modules/product-attribute/service"

// GET /admin/products/:id/attributes — liste les caractéristiques d'un produit
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const values = await service.listProductAttributeValues(
    { product_id: req.params.id },
    { relations: ["attribute_type"] }
  )
  res.json({ attributes: values })
}

// POST /admin/products/:id/attributes — ajoute une caractéristique au produit
// Body: { attribute_type_id: string, value: string }
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { attribute_type_id, value } = req.body as any

  if (!attribute_type_id || !value) {
    return res.status(400).json({ message: "attribute_type_id and value are required" })
  }

  const attrValue = await service.createProductAttributeValues({
    product_id: req.params.id,
    attribute_type_id,
    value,
  })
  res.status(201).json({ attribute: attrValue })
}

// DELETE /admin/products/:id/attributes — supprime toutes les caractéristiques du produit
// ou passer ?value_id=xxx pour en supprimer une seule
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { value_id } = req.query as any

  if (value_id) {
    await service.deleteProductAttributeValues(value_id)
    res.json({ id: value_id, deleted: true })
  } else {
    const existing = await service.listProductAttributeValues({ product_id: req.params.id })
    const ids = existing.map((v: any) => v.id)
    if (ids.length > 0) await service.deleteProductAttributeValues(ids)
    res.json({ deleted: ids.length })
  }
}
