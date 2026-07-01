import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import fs from "fs"
import path from "path"
import { parse } from "csv-parse/sync"

function fixEncoding(str: string): string {
  return str || ""
}

// Arrondi au centime (Medusa stocke en plus petite unité monétaire)
function toCents(price: string): number {
  return Math.round(parseFloat(price || "0") * 100)
}

function toHandle(name: string, legacyId: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${slug}-${legacyId}`
}

export default async function importProducts({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)

  // Charge le mapping PS id → Medusa category id
  const mappingPath = path.join(__dirname, "category_mapping.json")
  if (!fs.existsSync(mappingPath)) {
    throw new Error("category_mapping.json introuvable — lance import-categories.ts d'abord")
  }
  const categoryMapping: Record<string, string> = JSON.parse(
    fs.readFileSync(mappingPath, "utf-8")
  )

  // Supprime les produits déjà importés (metadata.legacy_id présent) pour idempotence
  const existing = await productModuleService.listProducts(
    {},
    { take: 2000, select: ["id", "metadata"] }
  )
  const toDelete = existing
    .filter((p: any) => p.metadata?.legacy_id)
    .map((p: any) => p.id)

  if (toDelete.length > 0) {
    console.log(`Suppression de ${toDelete.length} produits existants...`)
    // Suppression par batch de 50
    for (let i = 0; i < toDelete.length; i += 50) {
      const batch = toDelete.slice(i, i + 50)
      await productModuleService.deleteProducts(batch)
    }
    console.log("Suppression terminée.")
  }

  const csvPath = path.join(__dirname, "products_clean.csv")
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV introuvable : ${csvPath}`)
  }

  const csv = fs.readFileSync(csvPath, "utf-8")
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as any[]

  console.log(`${rows.length} produits trouvés dans le CSV`)

  let created = 0
  let skipped = 0
  let errors = 0
  const BATCH_SIZE = 50

  // Convertit une ligne CSV en payload produit Medusa
  function rowToProduct(row: any) {
    const legacyId = row.id_product?.trim()
    const name = fixEncoding(row.name?.trim() || "")
    if (!legacyId || !name) return null

    const rawCategoryIds = (row.category_ids || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)

    const categories = rawCategoryIds
      .map((id: string) => categoryMapping[id])
      .filter(Boolean)
      .map((id: string) => ({ id }))

    const priceCents = toCents(row.price)
    const isActive = row.active !== "0"
    const stock = parseInt(row.stock || "0", 10)

    return {
      _legacyId: legacyId,
      _name: name,
      title: name,
      handle: toHandle(name, legacyId),
      description: fixEncoding(row.description?.trim() || ""),
      status: (isActive ? "published" : "draft") as "published" | "draft",
      categories,
      metadata: {
        legacy_id: legacyId,
        reference: row.reference?.trim() || "",
      },
      options: [{ title: "Titre", values: ["Default"] }],
      variants: [
        {
          title: "Default",
          options: { Titre: "Default" },
          manage_inventory: true,
          prices: priceCents > 0
            ? [{ amount: priceCents, currency_code: "eur" }]
            : [],
          inventory_quantity: stock,
        },
      ],
    }
  }

  // Prépare tous les produits valides
  const products = rows.map(rowToProduct).filter(Boolean) as any[]
  skipped = rows.length - products.length

  // Import par batch
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(products.length / BATCH_SIZE)

    try {
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: batch.map(({ _legacyId, _name, ...p }: any) => p),
        },
      })

      created += result.length
      console.log(
        `✔ Batch ${batchNum}/${totalBatches} — ${result.length} produits (total: ${created})`
      )
    } catch (err: any) {
      // En cas d'erreur sur le batch, on retombe en mode unitaire pour isoler le produit fautif
      console.warn(`⚠ Batch ${batchNum} échoué, passage en mode unitaire...`)
      for (const p of batch) {
        const { _legacyId, _name, ...payload } = p
        try {
          await createProductsWorkflow(container).run({
            input: { products: [payload] },
          })
          created++
          console.log(`  ✔ ${_name} (legacy ${_legacyId})`)
        } catch (e: any) {
          errors++
          console.error(`  ✗ ${_name} (legacy ${_legacyId}): ${e.message}`)
        }
      }
    }
  }

  console.log(`\nTerminé: ${created} créés, ${skipped} ignorés, ${errors} erreurs`)
}
