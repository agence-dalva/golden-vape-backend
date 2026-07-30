import { model } from "@medusajs/framework/utils"
import AttributeType from "./attribute-type"

// Image (logo) associée à une valeur prédéfinie d'un type d'attribut (ex: logo de marque).
// N'existe que pour les valeurs ayant effectivement une image uploadée (table éparse).
// value est un match texte sur AttributeType.preset_values, PAS une FK vers une entité valeur —
// il n'y en a pas : preset_values est un array de strings, product_attribute_value.value aussi.
// image_file_id est conservé en plus de image_url pour permettre un vrai delete du blob R2
// (IFileModuleService.deleteFiles exige un id, pas une URL) lors d'un remplacement/suppression.
const AttributeValueImage = model.define("attribute_value_image", {
  id: model.id().primaryKey(),
  value: model.text(),
  image_url: model.text().nullable(),
  image_file_id: model.text().nullable(),
  attribute_type: model.belongsTo(() => AttributeType, { mappedBy: "value_images" }),
})
  .indexes([
    {
      on: ["attribute_type_id", "value"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default AttributeValueImage
