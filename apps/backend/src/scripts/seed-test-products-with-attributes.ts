import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import ProductAttributeModuleService from "../modules/product-attribute/service"

// Crée 2 produits de test (draft) avec des caractéristiques assignées, pour valider tout le
// pipeline admin -> stockage -> API store -> affichage frontend. Réservé au développement local.
export default async function seedTestProductsWithAttributes({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const attributeService: ProductAttributeModuleService = container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const { data: salesChannels } = await query.graph({ entity: "sales_channel", fields: ["id"] })
  const salesChannelId = salesChannels[0]?.id
  if (!salesChannelId) throw new Error("Aucun sales_channel trouvé")

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "[TEST] E-liquide Fraise 50ml",
          status: "draft",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Titre", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              sku: "TEST-ELIQUIDE-FRAISE-50ML",
              options: { Titre: "Default" },
              manage_inventory: true,
              prices: [{ amount: 12.9, currency_code: "eur" }],
            },
          ],
        },
        {
          title: "[TEST] Kit Mod Alpha",
          status: "draft",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Titre", values: ["Default"] }],
          variants: [
            {
              title: "Default",
              sku: "TEST-KIT-MOD-ALPHA",
              options: { Titre: "Default" },
              manage_inventory: true,
              prices: [{ amount: 39.9, currency_code: "eur" }],
            },
          ],
        },
      ],
    },
  })

  const [eliquide, mod] = result
  console.log(`Créé : ${eliquide.title} (${eliquide.id})`)
  console.log(`Créé : ${mod.title} (${mod.id})`)

  const attributeTypes = await attributeService.listAttributeTypes({})
  const typeByName = new Map(attributeTypes.map((t: any) => [t.name, t]))

  async function assign(productId: string, typeName: string, values: string[]) {
    const type = typeByName.get(typeName) as any
    if (!type) {
      console.warn(`  ⚠ Type "${typeName}" introuvable, ignoré`)
      return
    }
    for (const value of values) {
      await attributeService.createProductAttributeValues({
        product_id: productId,
        attribute_type_id: type.id,
        value,
      })
    }
    console.log(`  + ${typeName}: ${values.join(", ")}`)
  }

  console.log(`\nCaractéristiques pour ${eliquide.title}:`)
  await assign(eliquide.id, "Contenance", ["50ml"])
  await assign(eliquide.id, "Saveur", ["Fruités", "Fruités Frais"])
  await assign(eliquide.id, "Taux de nicotine", ["3 mg", "6 mg"]) // allow_multiple: true
  await assign(eliquide.id, "Dosage PG/VG", ["50PG/50VG"])
  await assign(eliquide.id, "Origine", ["France"])

  console.log(`\nCaractéristiques pour ${mod.title}:`)
  await assign(mod.id, "Alimentation", ["1 accu 21700"])
  await assign(mod.id, "Autonomie", ["3000mah"])
  await assign(mod.id, "Marque", ["Lost Vape"])
  await assign(mod.id, "Origine", ["Chine"])

  console.log("\nTerminé.")
}
