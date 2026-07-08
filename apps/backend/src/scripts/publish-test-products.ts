import { ExecArgs } from "@medusajs/framework/types"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"

// Publie les produits [TEST] créés par seed-test-products-with-attributes.ts, pour pouvoir
// vérifier leur fiche côté boutique en ligne.
export default async function publishTestProducts({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)
  const products = await productModuleService.listProducts(
    { title: { $like: "[TEST]%" } } as any,
    { select: ["id", "title"] }
  )

  if (products.length === 0) {
    console.log("Aucun produit [TEST] trouvé.")
    return
  }

  await updateProductsWorkflow(container).run({
    input: {
      selector: { id: products.map((p: any) => p.id) },
      update: { status: "published" },
    },
  })

  products.forEach((p: any) => console.log(`Publié : ${p.title} (${p.id})`))
}
