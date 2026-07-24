import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { IFileModuleService } from "@medusajs/framework/types"
import { uploadFilesWorkflow } from "@medusajs/core-flows"
import { imageSize } from "image-size"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../../../../modules/product-attribute"
import ProductAttributeModuleService from "../../../../../../../modules/product-attribute/service"

// Bornes de dimensions pour un logo de marque : en dessous de MIN, illisible en vignette
// (40px dans le tableau admin, ~120px dans la grille storefront) ; au-dessus de MAX, disproportionné
// et inutilement lourd pour un logo affiché en petit.
const MIN_DIMENSION_PX = 100
const MAX_DIMENSION_PX = 1000

// POST /admin/attribute-types/:id/values/:value/image
// multipart/form-data, champ "file" — upload/remplace le logo d'une valeur prédéfinie.
// L'image est stockée via le provider de fichiers configuré (R2), pas en local.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { id: attribute_type_id, value } = req.params
  const file = req.file

  if (!file) {
    return res.status(400).json({ message: "file is required" })
  }

  let dimensions: { width?: number; height?: number }
  try {
    dimensions = imageSize(file.buffer)
  } catch {
    return res.status(400).json({ message: "Fichier image invalide ou format non reconnu" })
  }
  const { width, height } = dimensions
  if (!width || !height) {
    return res.status(400).json({ message: "Impossible de déterminer les dimensions de l'image" })
  }
  if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
    return res.status(400).json({
      message: `Image trop petite (${width}x${height}px) — minimum ${MIN_DIMENSION_PX}x${MIN_DIMENSION_PX}px requis`,
    })
  }
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    return res.status(400).json({
      message: `Image trop grande (${width}x${height}px) — maximum ${MAX_DIMENSION_PX}x${MAX_DIMENSION_PX}px autorisé`,
    })
  }

  const attributeType = await service.retrieveAttributeType(attribute_type_id)
  const presetValues = Array.isArray(attributeType.preset_values)
    ? (attributeType.preset_values as unknown as string[])
    : []
  if (!presetValues.includes(value)) {
    return res.status(400).json({ message: `"${value}" is not a preset value of this attribute type` })
  }

  const { result } = await uploadFilesWorkflow(req.scope).run({
    input: {
      files: [{
        filename: `brands/${attribute_type_id}/${value}-${Date.now()}-${file.originalname}`,
        mimeType: file.mimetype,
        content: file.buffer.toString("base64"),
        access: "public",
      }],
    },
  })
  const uploaded = result[0]

  const existing = await service.listAttributeValueImages({ attribute_type_id, value })

  // Supprime l'ancien blob R2 si on remplace une image existante (best-effort)
  if (existing[0]?.image_file_id) {
    const fileService: IFileModuleService = req.scope.resolve(Modules.FILE)
    await fileService.deleteFiles(existing[0].image_file_id).catch(() => {})
  }

  const record = existing[0]
    ? await service.updateAttributeValueImages({
        id: existing[0].id,
        image_url: uploaded.url,
        image_file_id: uploaded.id,
      })
    : await service.createAttributeValueImages({
        attribute_type_id,
        value,
        image_url: uploaded.url,
        image_file_id: uploaded.id,
      })

  res.status(201).json({ attribute_value_image: record })
}

// DELETE /admin/attribute-types/:id/values/:value/image
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const { id: attribute_type_id, value } = req.params

  const existing = await service.listAttributeValueImages({ attribute_type_id, value })
  if (existing.length === 0) {
    return res.json({ deleted: false })
  }

  if (existing[0].image_file_id) {
    const fileService: IFileModuleService = req.scope.resolve(Modules.FILE)
    await fileService.deleteFiles(existing[0].image_file_id).catch(() => {})
  }

  await service.deleteAttributeValueImages(existing[0].id)
  res.json({ deleted: true })
}
