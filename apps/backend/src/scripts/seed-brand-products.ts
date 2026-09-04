import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import ProductAttributeModuleService from "../modules/product-attribute/service"

/*
  Rattache en masse des produits publiés à une marque, pour éprouver la pagination des pages
  de marque — un catalogue de démonstration n'a qu'un ou deux produits par marque, ce qui
  masque les plafonds de lecture. Réservé au développement local.

  Usage : medusa exec ./src/scripts/seed-brand-products.ts
*/
const BRAND = "Pulp"
const COUNT = 60

export default async function seedBrandProducts({ container }: ExecArgs) {
  const productModule = container.resolve(Modules.PRODUCT)
  const attributeService: ProductAttributeModuleService =
    container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const [marque] = await attributeService.listAttributeTypes({ name: "Marque" })
  if (!marque) {
    throw new Error("Type d'attribut « Marque » introuvable — lancer seed-attribute-types.")
  }

  const products = await productModule.listProducts(
    { status: "published" },
    { select: ["id", "title"], take: COUNT, order: { title: "ASC" } }
  )
  console.log(`${products.length} produits publiés retenus.`)

  // Repartir des mêmes affectations à chaque exécution, sans empiler les doublons.
  const existing = await attributeService.listProductAttributeValues(
    { attribute_type_id: marque.id, value: BRAND },
    { take: null }
  )
  if (existing.length > 0) {
    await attributeService.deleteProductAttributeValues(existing.map((value) => value.id))
    console.log(`${existing.length} affectation(s) précédente(s) retirée(s).`)
  }

  for (const product of products) {
    await attributeService.createProductAttributeValues({
      product_id: product.id,
      attribute_type_id: marque.id,
      value: BRAND,
    })
  }

  console.log(`\n${products.length} produits rattachés à la marque « ${BRAND} ».`)
}
