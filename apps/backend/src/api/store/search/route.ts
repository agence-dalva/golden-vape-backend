import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
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

function matchesAllWords(haystack: string, words: string[]): boolean {
  const normalized = normalize(haystack)
  return words.every((word) => normalized.includes(word))
}

type SearchProduct = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  images?: { url: string }[]
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
  const words = normalize(term).split(" ").filter(Boolean)

  const [products, brands] = await Promise.all([
    searchProducts(req, term, words, take),
    searchBrands(req, words, take),
  ])

  res.json({ products, brands, query: term })
}

async function searchProducts(
  req: MedusaRequest,
  term: string,
  words: string[],
  take: number
) {
  const productModule = req.scope.resolve(Modules.PRODUCT)

  const products = await productModule.listProducts(
    { q: term, status: ProductStatus.PUBLISHED },
    { select: ["id", "title", "handle", "thumbnail"], relations: ["images"], take: OVER_FETCH }
  )

  return (products as unknown as SearchProduct[])
    .filter((product) => product?.title && matchesAllWords(product.title, words))
    .slice(0, take)
    .map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      // Le catalogue migré ne renseigne pas thumbnail : la première image fait foi.
      image_url: product.thumbnail ?? product.images?.[0]?.url ?? null,
    }))
}

async function searchBrands(req: MedusaRequest, words: string[], take: number) {
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
    .filter((image) => matchesAllWords(image.value, words))
    .slice(0, take)
    .map((image) => ({ value: image.value, image_url: image.image_url }))
}
