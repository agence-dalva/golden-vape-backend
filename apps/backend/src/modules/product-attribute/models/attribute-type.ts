import { model } from "@medusajs/framework/utils"
import ProductAttributeValue from "./product-attribute-value"

// Définit un type de caractéristique (ex: "Taux de nicotine", "Contenance", "PG/VG")
// preset_values est la liste des valeurs prédéfinies proposées en dropdown dans l'admin
const AttributeType = model.define("attribute_type", {
  id: model.id().primaryKey(),
  name: model.text(),
  preset_values: model.json().default([]),
  allow_multiple: model.boolean().default(false),
  values: model.hasMany(() => ProductAttributeValue, { mappedBy: "attribute_type" }),
})

export default AttributeType
