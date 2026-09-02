import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../../../modules/product-attribute"
import type ProductAttributeModuleService from "../../../../../modules/product-attribute/service"

const DEFAULT_LIMIT = 4
const MAX_LIMIT = 12

/**
 * Univers complémentaires par défaut, rapprochés sur le nom de catégorie — les handles
 * portent un suffixe numérique issu de l'import Hiboutik, qui diffère d'une base à l'autre.
 *
 * Ce n'est qu'un repli : renseigner `metadata.cross_sell` sur une catégorie depuis
 * l'administration Medusa prend le dessus, et permet au commerçant d'ajuster ses
 * associations sans déploiement. La valeur attendue y est une liste de noms de catégories,
 * en tableau ou séparés par des virgules.
 */
const DEFAULT_CROSS_SELL: Record<string, string[]> = {
  liquides: ["resistances", "clearomiseurs et dripper"],
  kits: ["resistances", "accus", "liquides"],
  diy: ["aromes", "bases", "booster"],
  mods: ["accus", "clearomiseurs et dripper"],
  resistances: ["liquides", "kits"],
  "clearomiseurs et dripper": ["resistances", "liquides"],
  accus: ["chargeurs", "mods"],
}

function simplify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

function readConfiguredCrossSell(metadata: unknown): string[] | null {
  const configured = (metadata as { cross_sell?: unknown } | null)?.cross_sell

  if (Array.isArray(configured)) {
    return configured.map(String)
  }
  if (typeof configured === "string" && configured.trim()) {
    return configured.split(",").map((entry) => entry.trim())
  }
  return null
}

/**
 * GET /store/products/:id/related — suggestions calculées côté serveur.
 *
 * Renvoie des identifiants plutôt que des produits complets : le storefront les repasse à
 * /store/products, qui applique le contexte de prix de la région. Dupliquer ce calcul ici
 * ferait diverger les prix affichés d'une section à l'autre.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT)

  const productModule = req.scope.resolve(Modules.PRODUCT)
  const attributeService: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const [product] = await productModule.listProducts(
    { id },
    { select: ["id"], relations: ["categories"] }
  )

  if (!product) {
    res.json({ similar: [], complementary: [] })
    return
  }

  const categories = (product.categories ?? []) as {
    id: string
    name: string
    metadata?: Record<string, unknown> | null
  }[]

  const [similar, complementary] = await Promise.all([
    findSimilar(productModule, attributeService, id, categories, limit),
    findComplementary(productModule, categories, limit),
  ])

  res.json({ similar, complementary })
}

async function productIdsInCategories(
  productModule: IProductModuleService,
  categoryIds: string[],
  exclude: string[],
  limit: number
): Promise<string[]> {
  if (categoryIds.length === 0) return []

  // On interroge large pour pouvoir écarter les produits déjà retenus sans se retrouver
  // avec une rangée incomplète.
  const products = await productModule.listProducts(
    { categories: { id: categoryIds }, status: ProductStatus.PUBLISHED },
    { select: ["id"], take: limit + exclude.length + 12 }
  )

  return (products as { id: string }[])
    .map((entry) => entry.id)
    .filter((entry) => !exclude.includes(entry))
    .slice(0, limit)
}

/** Même marque d'abord — le signal de proximité le plus fort — puis même catégorie. */
async function findSimilar(
  productModule: IProductModuleService,
  attributeService: ProductAttributeModuleService,
  productId: string,
  categories: { id: string }[],
  limit: number
): Promise<string[]> {
  const collected: string[] = []

  const [marqueType] = await attributeService.listAttributeTypes({ name: "Marque" })
  if (marqueType) {
    const [own] = (await attributeService.listProductAttributeValues({
      attribute_type_id: marqueType.id,
      product_id: productId,
    })) as { value: string }[]

    if (own?.value) {
      const sameBrand = (await attributeService.listProductAttributeValues({
        attribute_type_id: marqueType.id,
        value: own.value,
      })) as { product_id: string }[]

      for (const entry of sameBrand) {
        if (entry.product_id !== productId && !collected.includes(entry.product_id)) {
          collected.push(entry.product_id)
        }
      }
    }
  }

  if (collected.length >= limit) {
    return collected.slice(0, limit)
  }

  const fromCategory = await productIdsInCategories(
    productModule,
    categories.map((category) => category.id),
    [productId, ...collected],
    limit - collected.length
  )

  return [...collected, ...fromCategory].slice(0, limit)
}

/** Univers complémentaires, pour compléter l'achat plutôt que le remplacer. */
async function findComplementary(
  productModule: IProductModuleService,
  categories: { id: string; name: string; metadata?: Record<string, unknown> | null }[],
  limit: number
): Promise<string[]> {
  const wanted = new Set<string>()

  for (const category of categories) {
    const configured = readConfiguredCrossSell(category.metadata)
    const names = configured ?? DEFAULT_CROSS_SELL[simplify(category.name)] ?? []
    names.forEach((name) => wanted.add(simplify(name)))
  }

  if (wanted.size === 0) return []

  const allCategories = (await productModule.listProductCategories(
    {},
    { select: ["id", "name"], take: 500 }
  )) as { id: string; name: string }[]

  const targetIds = allCategories
    .filter((category) => wanted.has(simplify(category.name)))
    .map((category) => category.id)

  return productIdsInCategories(
    productModule,
    targetIds,
    categories.map((category) => category.id),
    limit
  )
}
