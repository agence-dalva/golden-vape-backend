import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

// Corrige le nom des 2 catégories de test : "[TEST] Catégorie A/B" génère un handle avec des
// crochets littéraux ("[test]-categorie-a"), ce qui casse le routage dynamique Next.js
// (/categories/[handle]). Renommé sans crochets pour obtenir un handle propre.
export default async function fixTestCategoryNames({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)

  const categories = await productModuleService.listProductCategories(
    {
      name: [
        "[TEST] Catégorie A",
        "[TEST] Catégorie B",
        "TEST Catégorie A",
        "TEST Catégorie B",
      ],
    } as any,
    { select: ["id", "name", "handle"] }
  )

  if (categories.length === 0) {
    console.log("Aucune catégorie [TEST] à renommer.")
    return
  }

  const renameMap: Record<string, { name: string; handle: string }> = {
    "[TEST] Catégorie A": { name: "TEST Catégorie A", handle: "test-categorie-a" },
    "[TEST] Catégorie B": { name: "TEST Catégorie B", handle: "test-categorie-b" },
    "TEST Catégorie A": { name: "TEST Catégorie A", handle: "test-categorie-a" },
    "TEST Catégorie B": { name: "TEST Catégorie B", handle: "test-categorie-b" },
  }

  for (const c of categories as any[]) {
    const target = renameMap[c.name]
    if (!target) continue
    await productModuleService.updateProductCategories(c.id, target)
  }

  const updated = await productModuleService.listProductCategories(
    { id: categories.map((c: any) => c.id) } as any,
    { select: ["id", "name", "handle"] }
  )
  updated.forEach((c: any) => console.log(`${c.name} -> handle: ${c.handle}`))
}
