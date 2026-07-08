import { model } from "@medusajs/framework/utils"
import ProductAttributeValue from "./product-attribute-value"

// Définit un type de caractéristique (ex: "Taux de nicotine", "Contenance", "PG/VG")
// preset_values est la liste des valeurs prédéfinies proposées en dropdown dans l'admin
const AttributeType = model.define("attribute_type", {
  id: model.id().primaryKey(),
  name: model.text(),
  // Stocké en jsonb comme un array de strings ; model.json() type pour Record<string, unknown>
  // faute d'un type array dédié dans le DML Medusa — le cast ci-dessous reflète le vrai stockage.
  preset_values: model.json().default([] as unknown as Record<string, unknown>),
  allow_multiple: model.boolean().default(false),
  values: model.hasMany(() => ProductAttributeValue, { mappedBy: "attribute_type" }),
})

export default AttributeType
