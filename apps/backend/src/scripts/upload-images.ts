import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { IFileModuleService } from "@medusajs/framework/types"
import fs from "fs"
import path from "path"
import { parse } from "csv-parse/sync"

const IMAGES_DIR = "/Users/davidplanchon/Documents/Golden Vape/golden-vape-images"

// Reconstruit le chemin local d'une image PS à partir de son id_image
// ex: 1234 → /1/2/3/4/1234.jpg
function getImagePath(idImage: string): string | null {
  const digits = idImage.split("")
  const subPath = digits.join("/")
  const filePath = path.join(IMAGES_DIR, subPath, `${idImage}.jpg`)
  return fs.existsSync(filePath) ? filePath : null
}

export default async function uploadImages({ container }: ExecArgs) {
  const fileService: IFileModuleService = container.resolve(Modules.FILE)
  const productModuleService = container.resolve(Modules.PRODUCT)

  // Charge le mapping legacy_id PS → Medusa product id
  const mappingPath = path.join(__dirname, "category_mapping.json")
  // On a besoin du mapping produit, pas catégorie — on liste les produits directement
  const allProducts = await productModuleService.listProducts(
    {},
    { select: ["id", "metadata"], take: 5000 }
  )

  // Map legacy_id → medusa product id
  const legacyToMedusa: Record<string, string> = {}
  for (const p of allProducts) {
    const legacyId = (p.metadata as any)?.legacy_id
    if (legacyId) legacyToMedusa[legacyId] = p.id
  }

  console.log(`${Object.keys(legacyToMedusa).length} produits avec legacy_id trouvés`)

  // Lit le CSV des images PS
  const csvPath = path.join(__dirname, "ps_images.csv")
  const csv = fs.readFileSync(csvPath, "utf-8")
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as any[]

  console.log(`${rows.length} images à traiter`)

  // Groupe par id_product, triées par position
  const byProduct: Record<string, any[]> = {}
  for (const row of rows) {
    const pid = row.id_product
    if (!byProduct[pid]) byProduct[pid] = []
    byProduct[pid].push(row)
  }

  let uploaded = 0
  let skipped = 0
  let errors = 0
  const productCount = Object.keys(byProduct).length
  let productsDone = 0

  for (const [psProductId, images] of Object.entries(byProduct)) {
    const medusaProductId = legacyToMedusa[psProductId]
    if (!medusaProductId) {
      skipped += images.length
      continue
    }

    productsDone++
    const imageUrls: { url: string }[] = []

    // Trie par position, cover en premier
    const sorted = [...images].sort((a, b) => {
      if (a.cover === "1" && b.cover !== "1") return -1
      if (b.cover === "1" && a.cover !== "1") return 1
      return Number(a.position) - Number(b.position)
    })

    for (const img of sorted) {
      const localPath = getImagePath(img.id_image)
      if (!localPath) {
        skipped++
        continue
      }

      try {
        const fileContent = fs.readFileSync(localPath)
        const uploaded_file = await fileService.createFiles({
          filename: `products/${psProductId}/${img.id_image}.jpg`,
          mimeType: "image/jpeg",
          content: fileContent.toString("base64"),
          access: "public",
        })
        imageUrls.push({ url: uploaded_file.url })
        uploaded++
      } catch (e: any) {
        console.error(`  ✗ image ${img.id_image}: ${e.message}`)
        errors++
      }
    }

    if (imageUrls.length > 0) {
      await productModuleService.updateProducts(medusaProductId, {
        images: imageUrls,
      })
    }

    if (productsDone % 50 === 0) {
      console.log(`[${productsDone}/${productCount}] produits traités — ${uploaded} images uploadées`)
    }
  }

  console.log(`\nTerminé: ${uploaded} uploadées, ${skipped} ignorées, ${errors} erreurs`)
}
