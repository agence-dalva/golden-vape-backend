import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import type ProductAttributeModuleService from "../modules/product-attribute/service"

/**
 * Couverture de l'attribut « Marque » et croisement marques × catégories racines.
 *
 * Sert à décider si un méga-menu peut afficher les marques propres à chaque catégorie :
 * il faut à la fois que l'attribut soit renseigné, et que les listes diffèrent assez d'une
 * catégorie à l'autre pour ne pas afficher trois fois la même grille.
 *
 *   npx medusa exec ./src/scripts/check-brand-coverage.js
 */
export default async function checkBrandCoverage({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const service: ProductAttributeModuleService = container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const [marqueType] = await service.listAttributeTypes({ name: "Marque" })
  if (!marqueType) {
    console.error("Aucun type d'attribut « Marque ».")
    return
  }

  const values = (await service.listProductAttributeValues(
    { attribute_type_id: marqueType.id },
    { take: 100000 }
  )) as { product_id: string; value: string }[]

  const marqueParProduit = new Map<string, string>()
  for (const entry of values) marqueParProduit.set(entry.product_id, entry.value)

  const logos = await service.listAttributeValueImages({ attribute_type_id: marqueType.id })

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "parent_category_id"],
    pagination: { take: 1000, skip: 0 },
  })
  const parDefaut = new Map(categories.map((c) => [c.id, c]))
  const racine = (id: string): string | null => {
    let node = parDefaut.get(id)
    while (node?.parent_category_id) node = parDefaut.get(node.parent_category_id)
    return node?.name ?? null
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "categories.id"],
    pagination: { take: 100000, skip: 0 },
  })

  // Le titre porte souvent la marque entre crochets : point de comparaison quand
  // l'attribut n'est pas renseigné.
  const depuisTitre = (title: string) => title.match(/\[([^\]]+)\]\s*$/)?.[1]?.trim() ?? null

  let avecAttribut = 0
  let titreSeulement = 0
  const parCategorie = new Map<string, Set<string>>()

  for (const product of products) {
    const marque = marqueParProduit.get(product.id) ?? null
    if (marque) avecAttribut++
    else if (depuisTitre(product.title)) titreSeulement++

    if (!marque) continue
    for (const category of product.categories ?? []) {
      const root = category?.id ? racine(category.id) : null
      if (!root) continue
      if (!parCategorie.has(root)) parCategorie.set(root, new Set())
      parCategorie.get(root)!.add(marque)
    }
  }

  console.info(
    `\nCOUVERTURE\n` +
      `  produits                        : ${products.length}\n` +
      `  avec l'attribut « Marque »      : ${avecAttribut}` +
      ` (${Math.round((avecAttribut / Math.max(products.length, 1)) * 100)} %)\n` +
      `  sans attribut mais marque dans le titre : ${titreSeulement}\n` +
      `  marques distinctes utilisées    : ${new Set(marqueParProduit.values()).size}\n` +
      `  marques avec un logo            : ${logos.length}`
  )

  const rangs = [...parCategorie.entries()].sort((a, b) => b[1].size - a[1].size)
  console.info("\nMARQUES PAR CATÉGORIE RACINE")
  for (const [name, set] of rangs) console.info(`  ${String(set.size).padStart(4)}  ${name}`)

  console.info("\nRECOUVREMENT (marques communes entre deux catégories)")
  for (let i = 0; i < rangs.length; i++) {
    for (let j = i + 1; j < rangs.length; j++) {
      const commun = [...rangs[i][1]].filter((m) => rangs[j][1].has(m)).length
      if (commun > 0) {
        console.info(
          `  ${String(commun).padStart(4)}  ${rangs[i][0]} ∩ ${rangs[j][0]}` +
            `   (sur ${rangs[i][1].size} et ${rangs[j][1].size})`
        )
      }
    }
  }
  console.info("")
}
