import {
  createProductCategoriesWorkflow,
  deleteProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import fs from "fs"
import path from "path"
import { parse } from "csv-parse/sync"

// PS "Racine" (level 0) et "Produits" (level 1) sont des catégories internes
// PS sans équivalent Medusa — on les ignore et on part du level 2 comme racine.
const SKIP_IDS = new Set(["1", "2"])

function toHandle(name: string, legacyId: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${slug}-${legacyId}`
}

export default async function importCategories({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)

  // Supprime toutes les catégories importées précédemment (metadata.legacy_id présent)
  const existing = await productModuleService.listProductCategories(
    {},
    { take: 500 }
  )
  const toDelete = existing
    .filter((c: any) => c.metadata?.legacy_id)
    .map((c: any) => c.id)

  if (toDelete.length > 0) {
    console.log(`🗑  Suppression de ${toDelete.length} catégories existantes...`)
    await deleteProductCategoriesWorkflow(container).run({
      input: { ids: toDelete },
    })
  }

  const csvPath = path.join(__dirname, "products_categories.csv")
  const csv = fs.readFileSync(csvPath, "utf-8")
  const rows = parse(csv, { columns: true, bom: true }) as any[]

  // Tri par level_depth pour garantir que les parents existent avant les enfants
  rows.sort((a, b) => Number(a.level_depth) - Number(b.level_depth))

  const legacyToMedusaId: Record<string, string> = {}

  for (const row of rows) {
    if (row.active === "0" || SKIP_IDS.has(row.id_category)) continue

    const parent_category_id =
      !SKIP_IDS.has(row.id_parent) && legacyToMedusaId[row.id_parent]
        ? legacyToMedusaId[row.id_parent]
        : undefined

    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          {
            name: row.name,
            handle: toHandle(row.name, row.id_category),
            is_active: true,
            parent_category_id,
            metadata: { legacy_id: row.id_category },
          },
        ],
      },
    })

    legacyToMedusaId[row.id_category] = result[0].id
    console.log(`✔ ${row.name} (legacy ${row.id_category}) → ${result[0].id}`)
  }

  const outputPath = path.join(__dirname, "category_mapping.json")
  fs.writeFileSync(outputPath, JSON.stringify(legacyToMedusaId, null, 2))
  console.log(`\nMapping sauvegardé dans ${outputPath}`)
}
