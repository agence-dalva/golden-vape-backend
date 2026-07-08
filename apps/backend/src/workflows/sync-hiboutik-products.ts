import {
  createStep,
  createWorkflow,
  transform,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import {
  fetchAllHiboutikProducts,
  fetchHiboutikCategories,
  fetchHiboutikProductDetail,
  HiboutikProduct,
  HiboutikProductDetail,
} from "../modules/hiboutik/client"

type HiboutikProductWithCategory = HiboutikProduct & { category_name: string }

const EMPTY_DETAIL: HiboutikProductDetail = { sizeDetails: [], stockBySize: new Map() }

const VARIANT_OPTION_TITLE = "Déclinaison"

// Normalise un nom pour comparaison : minuscule, sans accents/ponctuation, mots triés (ordre ignoré)
export function normalizeProductName(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  return stripped.split(/\s+/).filter(Boolean).sort().join(" ")
}

// Medusa v2 stocke les prix en unité décimale normale (10 = 10€), pas en centimes.
// Le prix Hiboutik est TTC (TVA 20%) ; Medusa doit stocker du HT pour que la taxe configurée
// sur la région France recalcule le bon TTC à l'affichage, sans double-compter la TVA.
const VAT_RATE = 1.2

function toAmount(price: string | number | null | undefined): number {
  const value = typeof price === "string" ? parseFloat(price) : price
  return value && value > 0 ? Math.round((value / VAT_RATE) * 100) / 100 : 0
}

// Déduplique les noms de déclinaison (ex: "Turbo Red" apparaît deux fois chez GO MAX)
// en suffixant par le size_id en cas de collision, pour garder des valeurs d'option uniques.
function uniqueVariantNames(sizes: { size_id: number; size_name: string }[]): Map<number, string> {
  const seen = new Map<string, number>()
  const names = new Map<number, string>()
  for (const size of sizes) {
    const base = size.size_name.trim() || `Taille ${size.size_id}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    names.set(size.size_id, count === 0 ? base : `${base} (${size.size_id})`)
  }
  return names
}

// Note : createProductsWorkflow ignore silencieusement inventory_quantity sur le variant —
// le stock doit être appliqué après coup via createInventoryLevelsWorkflow (cf. createProductsInBatches).
// On retourne donc en plus une map sku -> quantité voulue, à consommer une fois les variantes créées.
// sansSalesChannelId lié, le produit reste invisible côté store même une fois publié manuellement.
function toHiboutikProductPayload(
  product: HiboutikProduct,
  detail: HiboutikProductDetail,
  salesChannelId: string | null
) {
  const amount = toAmount(product.product_price)
  const prices = amount > 0 ? [{ amount, currency_code: "eur" }] : []
  const title = product.product_model?.trim() || product.product_barcode!
  const stockBySize = detail.stockBySize
  const stockBySku = new Map<string, number>()
  const sales_channels = salesChannelId ? [{ id: salesChannelId }] : undefined

  // detail.sizeDetails = déclinaisons réellement actives pour ce produit (contrairement à
  // product.product_size_details qui liste toutes les déclinaisons possibles du gabarit produit)
  const sizes = detail.sizeDetails.filter((s) => s.barcode)

  if (sizes.length === 0) {
    stockBySku.set(product.product_barcode!, stockBySize.get(0) || 0)
    return {
      stockBySku,
      payload: {
        title,
        status: "draft" as const,
        metadata: { hiboutik_id: product.product_id },
        sales_channels,
        options: [{ title: "Titre", values: ["Default"] }],
        variants: [
          {
            title: "Default",
            sku: product.product_barcode!,
            options: { Titre: "Default" },
            manage_inventory: true,
            prices,
          },
        ],
      },
    }
  }

  const variantNames = uniqueVariantNames(sizes)
  for (const size of sizes) {
    stockBySku.set(size.barcode, stockBySize.get(size.size_id) || 0)
  }

  return {
    stockBySku,
    payload: {
      title,
      status: "draft" as const,
      metadata: { hiboutik_id: product.product_id },
      sales_channels,
      options: [
        {
          title: VARIANT_OPTION_TITLE,
          values: Array.from(variantNames.values()),
        },
      ],
      variants: sizes.map((size) => ({
        title: variantNames.get(size.size_id)!,
        sku: size.barcode,
        options: { [VARIANT_OPTION_TITLE]: variantNames.get(size.size_id)! },
        manage_inventory: true,
        prices,
      })),
    },
  }
}

// Récupère le détail (déclinaisons actives + stock) de chaque produit du batch en parallèle
async function fetchDetailForBatch(batch: HiboutikProduct[]): Promise<Map<number, HiboutikProductDetail>> {
  const entries = await Promise.all(
    batch.map(async (product) => {
      try {
        return [product.product_id, await fetchHiboutikProductDetail(product.product_id)] as const
      } catch {
        // Le détail est nécessaire pour les variantes/stock : en cas d'échec ponctuel, on crée
        // quand même le produit en mode simple (0 stock) plutôt que de bloquer tout le batch
        return [product.product_id, EMPTY_DETAIL] as const
      }
    })
  )
  return new Map(entries)
}

// Applique le stock voulu (par SKU) sur les variantes qui viennent d'être créées, via une
// stock location existante — createProductsWorkflow ignore inventory_quantity, donc ce
// deuxième passage est nécessaire pour que le stock Medusa reflète vraiment celui d'Hiboutik.
async function applyStockToCreatedProducts(
  container: any,
  createdProducts: any[],
  stockBySku: Map<string, number>
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
  })
  const locationId = stockLocations[0]?.id
  if (!locationId) return // pas de stock location configurée : on laisse le stock à 0

  const variantIds = createdProducts.flatMap((p) => p.variants.map((v: any) => v.id))
  if (variantIds.length === 0) return

  const { data: links } = await query.graph({
    entity: "product_variant_inventory_item",
    filters: { variant_id: variantIds },
    fields: ["variant_id", "inventory_item_id"],
  })

  const { data: variants } = await query.graph({
    entity: "product_variant",
    filters: { id: variantIds },
    fields: ["id", "sku"],
  })
  const skuByVariantId = new Map<string, string>(variants.map((v: any) => [v.id, v.sku]))

  const inventoryLevels = links
    .map((link: any) => {
      const sku = skuByVariantId.get(link.variant_id)
      const quantity = sku ? stockBySku.get(sku) : undefined
      return quantity
        ? { inventory_item_id: link.inventory_item_id, location_id: locationId, stocked_quantity: quantity }
        : null
    })
    .filter(Boolean)

  if (inventoryLevels.length > 0) {
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: inventoryLevels as any } })
  }
}

// Résout le canal de vente par défaut — sans lui, un produit reste invisible côté store
// même une fois publié manuellement dans l'admin.
async function resolveDefaultSalesChannelId(container: any): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
  })
  return salesChannels[0]?.id ?? null
}

async function createProductsInBatches(
  container: any,
  products: HiboutikProduct[]
) {
  const BATCH_SIZE = 50
  const created: string[] = []
  const errors: { product_ref: string; message: string }[] = []
  const salesChannelId = await resolveDefaultSalesChannelId(container)

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE)
    const detailByProduct = await fetchDetailForBatch(batch)
    const built = batch.map((p) =>
      toHiboutikProductPayload(p, detailByProduct.get(p.product_id)!, salesChannelId)
    )
    const stockBySku = new Map(built.flatMap((b) => [...b.stockBySku.entries()]))

    try {
      const { result } = await createProductsWorkflow(container).run({
        input: { products: built.map((b) => b.payload) },
      })
      created.push(...result.map((p: any) => p.id))
      await applyStockToCreatedProducts(container, result, stockBySku)
    } catch (err) {
      // Le batch a échoué : on retombe en mode unitaire pour isoler le(s) produit(s) fautif(s)
      for (let j = 0; j < batch.length; j++) {
        const product = batch[j]
        const { payload, stockBySku: unitStockBySku } = built[j]
        try {
          const { result } = await createProductsWorkflow(container).run({
            input: { products: [payload] },
          })
          created.push(...result.map((p: any) => p.id))
          await applyStockToCreatedProducts(container, result, unitStockBySku)
        } catch (unitErr: any) {
          errors.push({
            product_ref: product.product_barcode || String(product.product_id),
            message: unitErr?.message || "Erreur inconnue",
          })
        }
      }
    }
  }

  return { created: created.length, errors }
}

const fetchHiboutikProductsStep = createStep(
  "fetch-hiboutik-products",
  async () => {
    const products = await fetchAllHiboutikProducts()
    return new StepResponse(products)
  }
)

// Matching en couches : code-barres du produit en priorité (fiable même si le nom diverge),
// repli sur le nom normalisé (utile tant que le SKU Medusa n'est pas encore renseigné).
// Ce premier passage reste volontairement rapide : product_barcode (liste paginée) est fiable,
// contrairement à product_size_details qui liste tout le gabarit — cf. enrichMissingProductsStep
// pour une seconde passe plus précise sur les codes-barres de déclinaison, une fois filtré.
const diffAgainstMedusaStep = createStep(
  "diff-hiboutik-products-against-medusa",
  async (hiboutikProducts: HiboutikProduct[], { container }) => {
    const productModuleService = container.resolve(Modules.PRODUCT)

    const existingProducts = await productModuleService.listProducts(
      {},
      { select: ["title"], take: null }
    )
    const existingNames = new Set(
      existingProducts.map((p: any) => normalizeProductName(p.title))
    )

    const existingVariants = await productModuleService.listProductVariants(
      {},
      { select: ["sku"], take: null }
    )
    const existingSkus = new Set(
      existingVariants.map((v: any) => v.sku).filter(Boolean)
    )

    const missing = hiboutikProducts.filter((p) => {
      if (p.product_barcode && existingSkus.has(p.product_barcode)) return false
      return !existingNames.has(normalizeProductName(p.product_model || ""))
    })

    return new StepResponse({
      missing,
      matched: hiboutikProducts.length - missing.length,
      // Tableau plutôt que Set : les données de step transitent en JSON entre les étapes du workflow
      existingSkus: Array.from(existingSkus) as string[],
    })
  }
)

const enrichMissingProductsStep = createStep(
  "enrich-missing-hiboutik-products",
  async ({ missing, existingSkus: existingSkusArray }: { missing: HiboutikProduct[]; existingSkus: string[] }) => {
    const existingSkus = new Set(existingSkusArray)
    const categories = await fetchHiboutikCategories()

    // product.product_size_details (liste paginée) contient toutes les déclinaisons possibles du
    // gabarit produit, pas celles réellement actives — on corrige avec le détail par produit,
    // comme pour la création, pour que la colonne "Déclinaisons" de l'aperçu soit fiable.
    const details = await Promise.all(
      missing.map(async (p) => {
        try {
          return await fetchHiboutikProductDetail(p.product_id)
        } catch {
          return EMPTY_DETAIL
        }
      })
    )

    // Seconde passe de matching par code-barres, avec les vrais codes-barres de déclinaison cette
    // fois (le premier passage ne pouvait vérifier que product_barcode, fiable sans appel détail).
    const enriched: HiboutikProductWithCategory[] = missing
      .map((p, i) => ({
        ...p,
        product_size_details: details[i].sizeDetails.length > 0 ? details[i].sizeDetails : null,
        category_name:
          (p.product_category != null && categories.get(p.product_category)) ||
          "Non catégorisé",
      }))
      .filter((p, i) => !details[i].sizeDetails.some((s) => s.barcode && existingSkus.has(s.barcode)))

    return new StepResponse(enriched)
  }
)

const createHiboutikProductsStep = createStep(
  "create-hiboutik-products",
  async (products: HiboutikProduct[], { container }) => {
    const result = await createProductsInBatches(container, products)
    return new StepResponse(result)
  }
)

type PreviewOutput = {
  total_hiboutik: number
  matched: number
  missing: HiboutikProductWithCategory[]
}

export const previewHiboutikSyncWorkflow = createWorkflow(
  "preview-hiboutik-sync",
  () => {
    const hiboutikProducts = fetchHiboutikProductsStep()
    const diffResult = diffAgainstMedusaStep(hiboutikProducts)

    const enrichInput = transform({ diffResult }, ({ diffResult }) => ({
      missing: diffResult.missing,
      existingSkus: diffResult.existingSkus,
    }))
    const enrichedMissing = enrichMissingProductsStep(enrichInput)

    const output = transform(
      { hiboutikProducts, diffResult, enrichedMissing },
      ({ hiboutikProducts, diffResult, enrichedMissing }) => ({
        total_hiboutik: hiboutikProducts.length,
        matched: diffResult.matched,
        missing: enrichedMissing,
      })
    )

    return new WorkflowResponse<PreviewOutput>(output)
  }
)

type CreateOutput = {
  created: number
  errors: { product_ref: string; message: string }[]
}

export const createHiboutikProductsWorkflow = createWorkflow(
  "create-hiboutik-products",
  (input: HiboutikProduct[]) => {
    const result = createHiboutikProductsStep(input)
    return new WorkflowResponse<CreateOutput>(result)
  }
)
