import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createProductCategoriesWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"

// Complète [TEST] E-liquide Fraise 50ml uniquement (pas le Kit Mod Alpha) : dimensions natives
// Medusa + 2 catégories de test dédiées, pour valider le rendu du tableau produit.
export default async function updateTestProductDimensions({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)

  const products = await productModuleService.listProducts(
    { title: "[TEST] E-liquide Fraise 50ml" } as any,
    { select: ["id", "title"] }
  )
  const eliquide = products[0] as any
  if (!eliquide) {
    console.log("[TEST] E-liquide Fraise 50ml introuvable.")
    return
  }

  const existingCategories = await productModuleService.listProductCategories(
    { name: ["[TEST] Catégorie A", "[TEST] Catégorie B"] } as any,
    { select: ["id", "name"] }
  )
  const existingNames = new Set(existingCategories.map((c: any) => c.name))
  const toCreate = ["[TEST] Catégorie A", "[TEST] Catégorie B"].filter((n) => !existingNames.has(n))

  let categories = existingCategories
  if (toCreate.length > 0) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: toCreate.map((name) => ({ name, is_active: true })),
      },
    })
    categories = [...existingCategories, ...result]
    result.forEach((c: any) => console.log(`Catégorie créée : ${c.name} (${c.id})`))
  }

  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: eliquide.id },
      update: {
        height: 120,
        width: 40,
        length: 40,
        weight: 65,
        origin_country: "FR",
        category_ids: categories.map((c: any) => c.id),
      },
    },
  })

  console.log(`\nMis à jour : ${eliquide.title}`)
  console.log(`  Dimensions : 120x40x40 mm, 65 g, origine FR`)
  console.log(`  Catégories : ${categories.map((c: any) => c.name).join(", ")}`)
}
