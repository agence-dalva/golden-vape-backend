import { model } from "@medusajs/framework/utils"
import AttributeType from "./attribute-type"

// Valeur d'un attribut sur un produit spécifique
// value peut être une valeur prédéfinie ou custom (saisie libre)
const ProductAttributeValue = model.define("product_attribute_value", {
  id: model.id().primaryKey(),
  product_id: model.text(),
  value: model.text(),
  attribute_type: model.belongsTo(() => AttributeType, { mappedBy: "values" }),
})

export default ProductAttributeValue
