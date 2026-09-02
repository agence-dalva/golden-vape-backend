import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
  QueryContext,
} from "@medusajs/framework/utils"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import type ProductAttributeModuleService from "../../../modules/product-attribute/service"

const MIN_TERM_LENGTH = 2
const DEFAULT_LIMIT = 6
const MAX_LIMIT = 10

// La recherche libre de Medusa porte aussi sur la description : « mente » remonte ainsi des
// produits sans rapport. Pour une autocomplétion, mieux vaut ne rien afficher qu'afficher du
// bruit — on ne garde donc que les titres contenant réellement chaque mot cherché, et on
// interroge large pour compenser ce filtrage.
const OVER_FETCH = 60

/** Minuscule sans accents ni ponctuation, pour comparer « Crème » et « creme ». */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Les marques de vape s'écrivent indifféremment en un ou deux mots — « Geekvape » sur
 * l'emballage, « Geek Vape » dans le catalogue. On compare donc aussi les formes sans
 * espaces, sans quoi la graphie la plus courante ne trouverait rien.
 */
function matches(haystack: string, words: string[], collapsedTerm: string): boolean {
  const normalized = normalize(haystack)

  if (words.every((word) => normalized.includes(word))) {
    return true
  }
  return normalized.replace(/ /g, "").includes(collapsedTerm)
}

type SearchProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  images?: { url: string }[]
}

type QueriedVariant = {
  id: string
  title: string | null
  manage_inventory: boolean
  allow_backorder: boolean
  calculated_price?: { calculated_amount: number; currency_code: string } | null
  inventory_items?: {
    inventory?: { location_levels?: { stocked_quantity: number; reserved_quantity: number }[] }
  }[]
}

/**
 * Stock réellement disponible : ce qui est en rayon moins ce que des commandes en cours ont
 * déjà réservé, tous emplacements confondus. `null` quand aucun niveau n'est rattaché à la
 * variante — c'est une absence d'information, à ne pas confondre avec une rupture.
 */
function availableStock(variant: QueriedVariant): number | null {
  const levels = (variant.inventory_items ?? []).flatMap(
    (item) => item?.inventory?.location_levels ?? []
  )

  if (!variant.manage_inventory || levels.length === 0) {
    return null
  }
  return levels.reduce(
    (total, level) => total + (level.stocked_quantity ?? 0) - (level.reserved_quantity ?? 0),
    0
  )
}

// GET /store/search?q=menthe&limit=6 — produits et marques en un seul appel.
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { q, limit } = req.query as { q?: string; limit?: string }
  const term = (q ?? "").trim()

  if (term.length < MIN_TERM_LENGTH) {
    res.json({ products: [], brands: [], query: term })
    return
  }

  const take = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT)
  const normalized = normalize(term)
  const words = normalized.split(" ").filter(Boolean)
  const collapsed = normalized.replace(/ /g, "")

  const [products, brands] = await Promise.all([
    searchProducts(req, term, words, collapsed, take),
    searchBrands(req, words, collapsed, take),
  ])

  res.json({ products, brands, query: term })
}

async function searchProducts(
  req: MedusaRequest,
  term: string,
  words: string[],
  collapsed: string,
  take: number
) {
  const productModule = req.scope.resolve(Modules.PRODUCT)

  const found = await productModule.listProducts(
    { q: term, status: ProductStatus.PUBLISHED },
    { select: ["id", "title", "handle", "thumbnail"], relations: ["images"], take: OVER_FETCH }
  )

  const shortlist = (found as unknown as SearchProduct[])
    .filter((product) => product?.title && matches(product.title, words, collapsed))
    .slice(0, take)

  if (shortlist.length === 0) {
    return []
  }

  // Prix et stock demandent un contexte de tarification et les niveaux d'inventaire, que la
  // recherche libre ne renvoie pas. On les récupère en une passe, sur la poignée de produits
  // retenus seulement.
  const detailed = await withPricingAndStock(req, shortlist.map((product) => product.id))

  return shortlist.map((product) => {
    const variants = detailed.get(product.id) ?? []

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      // Le catalogue migré ne renseigne pas thumbnail : la première image fait foi.
      image_url: product.thumbnail ?? product.images?.[0]?.url ?? null,
      variants,
    }
  })
}

async function withPricingAndStock(req: MedusaRequest, productIds: string[]) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
    pagination: { take: 1, skip: 0 },
  })
  const region = regions[0]

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.title",
      "variants.manage_inventory",
      "variants.allow_backorder",
      "variants.calculated_price.*",
      "variants.inventory_items.inventory.location_levels.stocked_quantity",
      "variants.inventory_items.inventory.location_levels.reserved_quantity",
    ],
    filters: { id: productIds },
    ...(region
      ? {
          context: {
            variants: {
              calculated_price: QueryContext({
                region_id: region.id,
                currency_code: region.currency_code,
              }),
            },
          },
        }
      : {}),
  })

  const byProduct = new Map<string, ReturnType<typeof toVariant>[]>()
  for (const product of products) {
    byProduct.set(
      product.id,
      ((product.variants ?? []) as QueriedVariant[]).map(toVariant)
    )
  }
  return byProduct
}

function toVariant(variant: QueriedVariant) {
  return {
    id: variant.id,
    title: variant.title,
    price: variant.calculated_price
      ? {
          amount: variant.calculated_price.calculated_amount,
          currency_code: variant.calculated_price.currency_code,
        }
      : null,
    stock: availableStock(variant),
    allow_backorder: variant.allow_backorder,
  }
}

async function searchBrands(
  req: MedusaRequest,
  words: string[],
  collapsed: string,
  take: number
) {
  const service: ProductAttributeModuleService = req.scope.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const [marqueType] = await service.listAttributeTypes({ name: "Marque" })
  if (!marqueType) {
    return []
  }

  // Quelques dizaines de marques seulement : les filtrer en mémoire est instantané et
  // évite d'imposer une recherche insensible aux accents à la base.
  const images = await service.listAttributeValueImages(
    { attribute_type_id: marqueType.id },
    { order: { value: "ASC" } }
  )

  return (images as { value: string; image_url: string }[])
    .filter((image) => matches(image.value, words, collapsed))
    .slice(0, take)
    .map((image) => ({ value: image.value, image_url: image.image_url }))
}
