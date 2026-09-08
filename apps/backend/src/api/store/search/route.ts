import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ICacheService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, QueryContext } from "@medusajs/framework/utils"
import {
  INVALIDATED_AT_KEY,
  SEARCH_TTL,
  SEARCH_TTL_EMPTY,
  searchCacheKey,
} from "../../../lib/search-cache"
import { PRODUCT_ATTRIBUTE_MODULE } from "../../../modules/product-attribute"
import type ProductAttributeModuleService from "../../../modules/product-attribute/service"

/*
  Trois caractères, et non deux.

  Mesuré sur ce catalogue : « te » ramenait cent produits et 27,7 Ko pour deux lettres qui
  n'expriment aucune intention, au prix d'un parcours complet de la table — le même que pour
  un terme précis. « ten » ramène huit produits et 2,0 Ko, treize fois moins.

  La borne est répétée dans le composant de recherche, mais elle doit exister ici : un script
  qui appelle la route directement contourne le frontend.
*/
const MIN_TERM_LENGTH = 3
/*
  L'autocomplétion défile : mieux vaut une liste longue qu'un client convaincu que son produit
  n'existe pas parce qu'il n'entrait pas dans six lignes. Le panneau en montre une douzaine
  d'un coup et laisse défiler le reste.

  Cinquante plutôt que cent. Ce nombre commande deux coûts à la fois : les octets envoyés, et
  le travail de la seconde requête, qui va chercher le prix et le stock de chaque produit
  retenu — la partie la plus lourde de la route en production, où les variantes existent. Le
  diviser par deux les divise tous les deux.

  Cinquante couvre les termes réellement tapés : « menthe » en ramène trente-cinq, « fraise »
  cinquante-cinq. Seules les recherches par marque dépassent — « pulp » trouve cent sept
  produits — et une marque a sa propre page, qu'un raccourci propose dans le même panneau.
*/
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 300

/*
  Cache de la recherche. Clés et durées vivent dans `lib/search-cache`, partagées avec le
  souscripteur qui les périme.

  Une barre de recherche est le point le plus répétitif d'une boutique : les clients tapent
  les mêmes marques et les mêmes arômes, et chaque frappe retenue rejoue le même parcours
  complet de la table produit puis la lecture des prix et du stock. Mesuré sans cache, le
  endpoint plafonne à environ 185 requêtes par seconde et la latence double à chaque
  doublement de la charge : la signature d'une file d'attente, que le cache supprime.
*/
type SearchPayload = {
  products: Awaited<ReturnType<typeof searchProducts>>
  brands: Awaited<ReturnType<typeof searchBrands>>
}

/** L'horodatage n'est pas renvoyé au client : il ne sert qu'à comparer l'entrée à la date du
    dernier changement au catalogue. */
type CachedSearch = SearchPayload & { at: number }

/*
  Les produits sont cherchés en SQL plutôt que par la recherche libre de Medusa, pour deux
  raisons.

  La première : `q` porte aussi sur la description, si bien que « mente » remontait des
  produits sans rapport. Pour une autocomplétion, mieux vaut ne rien afficher qu'afficher du
  bruit — on s'en tient donc au titre et au sous-titre, ce dernier étant précisément le champ
  où l'équipe saisit les mots-clés sous lesquels les clients cherchent le produit.

  La seconde : `ILIKE` ne retire jamais les accents, et selon la collation de la base `lower()`
  ne descend même pas les majuscules accentuées. « debutant » ne trouvait donc pas
  « débutant », ni « étanche » « Étanche » — alors que personne ne saisit les accents dans une
  barre de recherche. Replier les accents en JS ne servait à rien : le SQL avait déjà écarté
  le produit.

  `translate` plutôt que l'extension `unaccent` : rien à installer, donc le même comportement
  en local, en préproduction et en production, sans migration.
*/
const ACCENT_FOLDING: [string, string][] = [
  ["àáâãäåÀÁÂÃÄÅ", "a"],
  ["çÇ", "c"],
  ["èéêëÈÉÊË", "e"],
  ["ìíîïÌÍÎÏ", "i"],
  ["ñÑ", "n"],
  ["òóôõöÒÓÔÕÖ", "o"],
  ["ùúûüÙÚÛÜ", "u"],
  ["ýÿÝ", "y"],
]
// Les deux chaînes de `translate` doivent avoir la même longueur : les dériver du même
// tableau évite de désaligner un caractère à la main.
const ACCENTED = ACCENT_FOLDING.map(([accented]) => accented).join("")
const PLAIN = ACCENT_FOLDING.map(([accented, plain]) => plain.repeat(accented.length)).join("")

/**
 * Transposition SQL de `normalize` : minuscules, sans accents, ponctuation réduite à une
 * espace. Les deux doivent rester alignées — le SQL sélectionne les produits, le JS filtre
 * les marques. Les chaînes interpolées sont des constantes du module, pas une saisie.
 */
function fold(column: string): string {
  return `regexp_replace(translate(lower(${column}), '${ACCENTED}', '${PLAIN}'), '[^a-z0-9]+', ' ', 'g')`
}

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

/**
 * Titre et sous-titre sont comparés séparément et non concaténés : « menthe » dans le titre
 * et « glaciale » dans le sous-titre ne font pas du produit un résultat pour « menthe
 * glaciale », qui désignerait alors n'importe quel produit mentholé.
 */
function matchesAny(haystacks: (string | null | undefined)[], words: string[], collapsedTerm: string) {
  return haystacks.some((haystack) => haystack && matches(haystack, words, collapsedTerm))
}

type SearchProduct = {
  id: string
  title: string
  subtitle: string | null
  handle: string
  image_url: string | null
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
  const debut = Date.now()
  const { q, limit } = req.query as { q?: string; limit?: string }
  const term = (q ?? "").trim()

  // Avant toute chose, et avant le cache : une requête trop courte ne doit toucher ni Redis
  // ni PostgreSQL.
  if (term.length < MIN_TERM_LENGTH) {
    res.setHeader("X-Search-Cache", "SKIP")
    res.json({ products: [], brands: [], query: term })
    return
  }

  // Borne basse autant que haute : une limite négative se serait retrouvée dans un `slice`,
  // qui compte alors depuis la fin et retire des résultats au lieu d'en garder.
  const take = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
  const normalized = normalize(term)
  const words = normalized.split(" ").filter(Boolean)
  const collapsed = normalized.replace(/ /g, "")

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const cache = req.scope.resolve<ICacheService>(Modules.CACHE)
  const cacheKey = searchCacheKey(take, normalized)

  /*
    L'entrée et la date du dernier changement au catalogue sont lues de front : la seconde ne
    dépend pas de la première, les enchaîner ajouterait un aller-retour à chaque recherche.

    Une panne de Redis ne doit pas emporter la recherche : lectures et écriture sont tolérées
    en échec, la requête retombe alors sur PostgreSQL comme avant le cache.
  */
  const [cached, invalidatedAt] = await Promise.all([
    cache.get<CachedSearch>(cacheKey).catch(() => null),
    cache.get<number>(INVALIDATED_AT_KEY).catch(() => null),
  ])

  // Une entrée écrite avant le dernier changement décrit un catalogue qui n'existe plus.
  if (cached && cached.at >= (invalidatedAt ?? 0)) {
    const { at: _ecrite, ...payload } = cached
    res.setHeader("X-Search-Cache", "HIT")
    journaliser(logger, normalized, "HIT", debut, payload.products.length)
    // `query` est renvoyé tel que le client l'a saisi, il n'a pas à sortir du cache.
    res.json({ ...payload, query: term })
    return
  }

  const [products, brands] = await Promise.all([
    searchProducts(req, words, collapsed, take),
    searchBrands(req, words, collapsed, take),
  ])

  const payload: SearchPayload = { products, brands }
  const vide = products.length === 0 && brands.length === 0
  /*
    La règle vise les mutations du domaine — créer une commande, modifier un produit — qui
    doivent passer par un workflow pour être rejouables et traçables. Écrire dans un cache
    n'en est pas une : rien n'est modifié dans la boutique, et l'entrée s'efface d'elle-même
    au bout d'une minute. L'envelopper dans un workflow ajouterait son coût à chaque
    recherche, précisément ce que ce cache existe pour éviter.
  */
  // eslint-disable-next-line @medusajs/no-service-mutations-in-api-route
  await cache
    .set(cacheKey, { ...payload, at: Date.now() }, vide ? SEARCH_TTL_EMPTY : SEARCH_TTL)
    .catch(() => {})

  res.setHeader("X-Search-Cache", cached ? "STALE" : "MISS")
  journaliser(logger, normalized, cached ? "STALE" : "MISS", debut, products.length)
  res.json({ ...payload, query: term })
}

/*
  Journalisé en `debug` et non en `info` : à cent quatre-vingts requêtes par seconde, une
  ligne par recherche noierait les journaux de production. `LOG_LEVEL=debug` les fait
  apparaître le temps d'une vérification. L'en-tête `X-Search-Cache`, lui, est toujours là et
  se lit dans les outils du navigateur.

  Le terme journalisé est sa forme repliée, pas la saisie : de quoi reconnaître une recherche
  sans en conserver la graphie exacte.
*/
function journaliser(
  logger: { debug: (message: string) => void },
  terme: string,
  cache: "HIT" | "MISS" | "STALE",
  debut: number,
  resultats: number
): void {
  logger.debug(`[search] q=${terme} cache=${cache} duree=${Date.now() - debut}ms resultats=${resultats}`)
}

async function searchProducts(
  req: MedusaRequest,
  words: string[],
  collapsed: string,
  take: number
) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const patterns = words.map((word) => `%${word}%`)
  const collapsedPattern = `%${collapsed}%`

  // Tous les mots dans le même champ. Répartis sur deux champs — « menthe » dans le titre,
  // « glaciale » dans le sous-titre — la correspondance ne désignerait plus rien de précis.
  const allInTitle = words.map(() => "titre LIKE ?").join(" AND ")
  const allInSubtitle = words.map(() => "sous_titre LIKE ?").join(" AND ")

  // Les marques de vape s'écrivent indifféremment en un ou deux mots — « Geekvape » sur
  // l'emballage, « Geek Vape » dans le catalogue : d'où la comparaison sans espaces.
  const { rows } = await knex.raw(
    `
    WITH catalogue AS (
      SELECT
        p.id,
        p.title,
        p.subtitle,
        p.handle,
        p.thumbnail,
        ${fold("p.title")} AS titre,
        ${fold("coalesce(p.subtitle, '')")} AS sous_titre
      FROM product p
      WHERE p.deleted_at IS NULL AND p.status = 'published'
    )
    SELECT
      id,
      title,
      subtitle,
      handle,
      -- Le catalogue migré ne renseigne pas thumbnail : la première image fait foi.
      coalesce(
        thumbnail,
        (
          SELECT i.url
          FROM image i
          WHERE i.product_id = catalogue.id AND i.deleted_at IS NULL
          ORDER BY i.rank
          LIMIT 1
        )
      ) AS image_url
    FROM catalogue
    WHERE (${allInTitle})
       OR (${allInSubtitle})
       OR replace(titre, ' ', '') LIKE ?
       OR replace(sous_titre, ' ', '') LIKE ?
    -- Un mot trouvé dans le titre désigne le produit plus sûrement que le même mot noyé dans
    -- une liste de mots-clés : ces produits passent devant.
    ORDER BY CASE WHEN (${allInTitle}) THEN 0 ELSE 1 END, title
    LIMIT ?
    `,
    [...patterns, ...patterns, collapsedPattern, collapsedPattern, ...patterns, take]
  )

  const shortlist = rows as SearchProduct[]

  if (shortlist.length === 0) {
    return []
  }

  // Prix et stock demandent un contexte de tarification et les niveaux d'inventaire, hors de
  // portée de cette requête. On les récupère en une passe, sur la poignée de produits retenus.
  const detailed = await withPricingAndStock(req, shortlist.map((product) => product.id))

  return shortlist.map((product) => ({
    id: product.id,
    title: product.title,
    subtitle: product.subtitle ?? null,
    handle: product.handle,
    image_url: product.image_url ?? null,
    variants: detailed.get(product.id) ?? [],
  }))
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
