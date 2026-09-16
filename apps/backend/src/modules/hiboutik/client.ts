import { MedusaError } from "@medusajs/framework/utils"
import { exigerIdentifiantsHiboutik, hiboutikOptionsFromEnv } from "./lib/options"

export type HiboutikSizeDetail = {
  size_id: number
  size_name: string
  barcode: string
}

export type HiboutikProduct = {
  product_id: number
  product_model: string
  product_barcode: string | null
  product_price: string | number | null
  product_size_details: HiboutikSizeDetail[] | null
  product_category: number | null
}

export type HiboutikCategory = {
  category_id: number
  category_name: string
}

export type HiboutikStockEntry = {
  product_id: number
  product_size: number // size_id de la déclinaison, 0 si produit sans déclinaison
  warehouse_id: number
  stock_available: number
}

/** Une ligne de `GET /stock_available/warehouse_id/{id}` : une déclinaison, son code-barres, son stock. */
export type HiboutikStockLine = HiboutikStockEntry & {
  inventory_alert?: number
  product_barcode: string | null
  product_supplier_reference?: string | null
}

export type HiboutikSaleRef = {
  sale_id: number
  ext_ref?: string | null
  completed?: number | boolean | null
  store_id?: number
  [cle: string]: unknown
}

export type HiboutikSaleLineItem = {
  line_item_id: number
  product_id?: number
  product_size?: number
  quantity?: number | string
  [cle: string]: unknown
}

export type HiboutikSale = HiboutikSaleRef & {
  line_items?: HiboutikSaleLineItem[]
}

const PAGE_SIZE = 250

export class HiboutikApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`Hiboutik API a répondu ${status} sur ${path}${body ? ` : ${body.slice(0, 300)}` : ""}`)
    this.name = "HiboutikApiError"
  }
}

type Methode = "GET" | "POST" | "PUT" | "DELETE"

type OptionsAppel = {
  method?: Methode
  body?: Record<string, unknown>
  /** Nombre de nouvelles tentatives au-delà de la première. */
  retries?: number
  timeoutMs?: number
}

/*
  Statuts qui autorisent une nouvelle tentative. Pour une écriture, uniquement ceux où le
  serveur a refusé la requête avant de la traiter : un délai dépassé sur un `POST /sales/` peut
  cacher une vente bel et bien créée, et une seconde tentative en ferait une deuxième. Ce cas-là
  se rattrape ailleurs, par la recherche sur la référence externe.
*/
const RELANCE_LECTURE = new Set([429, 502, 503, 504])
const RELANCE_ECRITURE = new Set([429, 503])
const ATTENTES_MS = [1000, 3000]

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function delaiDepuisRetryAfter(res: Response, defaut: number): number {
  const brut = res.headers.get("retry-after")
  const secondes = brut ? Number(brut) : NaN
  return Number.isFinite(secondes) && secondes > 0 ? Math.min(secondes * 1000, 30_000) : defaut
}

/**
 * Un seul point de passage vers l'API : authentification, délai maximal, relance mesurée,
 * erreur lisible avec le corps de la réponse. Les en-têtes sont rendus pour la pagination.
 */
async function hiboutikFetch<T>(
  path: string,
  options: OptionsAppel = {}
): Promise<{ data: T; headers: Headers }> {
  const config = hiboutikOptionsFromEnv()
  exigerIdentifiantsHiboutik(config)

  const method = options.method ?? "GET"
  const lecture = method === "GET"
  const relances = options.retries ?? (lecture ? 2 : 1)
  const timeoutMs = options.timeoutMs ?? config.timeoutMs
  const url = `https://${config.account}.hiboutik.com/api${path}`
  const autorisation = "Basic " + Buffer.from(`${config.user}:${config.apiKey}`).toString("base64")

  for (let tentative = 0; ; tentative++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: autorisation,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (erreur) {
      // Réseau ou délai dépassé : on ne rejoue qu'une lecture, jamais une écriture.
      if (lecture && tentative < relances) {
        await attendre(ATTENTES_MS[Math.min(tentative, ATTENTES_MS.length - 1)])
        continue
      }
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Hiboutik injoignable sur ${method} ${path} : ${erreur instanceof Error ? erreur.message : String(erreur)}`
      )
    }

    if (res.ok) {
      const texte = await res.text()
      return { data: (texte ? JSON.parse(texte) : null) as T, headers: res.headers }
    }

    const relancable = (lecture ? RELANCE_LECTURE : RELANCE_ECRITURE).has(res.status)
    if (relancable && tentative < relances) {
      await attendre(delaiDepuisRetryAfter(res, ATTENTES_MS[Math.min(tentative, ATTENTES_MS.length - 1)]))
      continue
    }

    throw new HiboutikApiError(res.status, `${method} ${path}`, await res.text().catch(() => ""))
  }
}

// Extrait le nombre total de pages depuis le header Content-Range: "1-250/2676"
function totalPagesFromContentRange(contentRange: string | null): number | null {
  const match = contentRange?.match(/\/(\d+)$/)
  if (!match) return null
  const total = parseInt(match[1], 10)
  return Math.ceil(total / PAGE_SIZE)
}

// Liste tous les produits actifs de l'inventaire Hiboutik, avec pagination
export async function fetchAllHiboutikProducts(): Promise<HiboutikProduct[]> {
  const products: HiboutikProduct[] = []
  let page = 1
  let totalPages: number | null = null

  while (true) {
    const { data: batch, headers } = await hiboutikFetch<HiboutikProduct[]>(`/products/?p=${page}`)

    if (totalPages === null) {
      totalPages = totalPagesFromContentRange(headers.get("content-range"))
    }

    if (!Array.isArray(batch) || batch.length === 0) break

    products.push(...batch)

    if (totalPages !== null ? page >= totalPages : batch.length < PAGE_SIZE) break
    page += 1
  }

  return products.filter((p) => !!p.product_barcode?.trim())
}

// Retourne une map category_id -> category_name pour affichage indicatif dans l'aperçu
export async function fetchHiboutikCategories(): Promise<Map<number, string>> {
  const { data: categories } = await hiboutikFetch<HiboutikCategory[]>("/categories")
  return new Map(categories.map((c) => [c.category_id, c.category_name]))
}

export type HiboutikProductDetail = {
  // Déclinaisons réellement actives pour ce produit (contrairement au champ product_size_details
  // de la liste paginée, qui contient TOUTES les déclinaisons possibles du gabarit produit, actives ou non)
  sizeDetails: HiboutikSizeDetail[]
  // size_id -> quantité en stock (0 = produit sans déclinaison). Un seul entrepôt sur ce compte ;
  // si plusieurs existaient, on les sommerait.
  stockBySize: Map<number, number>
}

// Récupère en un seul appel les déclinaisons actives et le stock d'un produit
export async function fetchHiboutikProductDetail(productId: number): Promise<HiboutikProductDetail> {
  const { data } = await hiboutikFetch<
    {
      product_size_details?: HiboutikSizeDetail[]
      stock_available?: HiboutikStockEntry[]
    }[]
  >(`/products/${productId}`)
  const detail = data?.[0]

  const stockBySize = new Map<number, number>()
  for (const entry of detail?.stock_available || []) {
    stockBySize.set(entry.product_size, (stockBySize.get(entry.product_size) || 0) + entry.stock_available)
  }

  return {
    sizeDetails: detail?.product_size_details || [],
    stockBySize,
  }
}

/*
  ── Stock ──────────────────────────────────────────────────────────────────────────────────
*/

/**
 * Tout le stock d'un entrepôt en un appel — quelque 5 500 lignes, sans pagination, chacune
 * avec le code-barres de sa déclinaison. L'URL fixe déjà l'entrepôt ; le filtre qui suit ne
 * fait que garantir qu'une réponse inattendue ne mêlera jamais le stock de l'autre boutique.
 */
export async function fetchStockAvailable(warehouseId: number): Promise<HiboutikStockLine[]> {
  const { data } = await hiboutikFetch<HiboutikStockLine[]>(`/stock_available/warehouse_id/${warehouseId}`)
  return (Array.isArray(data) ? data : []).filter((ligne) => Number(ligne.warehouse_id) === warehouseId)
}

/*
  ── Ventes ─────────────────────────────────────────────────────────────────────────────────

  Hiboutik ne connaît pas de « mouvement de stock » : une sortie s'enregistre comme une vente,
  et c'est ce que veut le marchand — une vente web doit apparaître dans ses synthèses comme
  une vente, pas comme une perte. La séquence est celle de la caisse : ouvrir, garnir,
  commenter, régler, clôturer. Le stock n'est décrémenté qu'à la clôture.
*/

export async function createSale(input: {
  store_id: number
  currency_code: string
  customer_id?: number
  vendor_id?: number
}): Promise<{ sale_id: number }> {
  const { data } = await hiboutikFetch<HiboutikSaleRef | HiboutikSaleRef[]>("/sales/", {
    method: "POST",
    body: input,
  })
  const vente = Array.isArray(data) ? data[0] : data
  const saleId = Number(vente?.sale_id)
  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Hiboutik n'a pas rendu d'identifiant de vente : ${JSON.stringify(data).slice(0, 300)}`
    )
  }
  return { sale_id: saleId }
}

export async function addProductToSale(input: {
  sale_id: number
  product_id: number
  size_id: number
  quantity: number
  product_price: string
  product_comments?: string
}): Promise<void> {
  await hiboutikFetch("/sales/add_product/", { method: "POST", body: input })
}

export type AttributVente = "ext_ref" | "payment" | "customer_id" | "vendor_id"

export async function setSaleAttribute(saleId: number, attribut: AttributVente, valeur: string): Promise<void> {
  await hiboutikFetch(`/sale/${saleId}/`, {
    method: "PUT",
    body: { sale_attribute: attribut, new_value: valeur },
  })
}

export async function setSaleComments(saleId: number, commentaires: string): Promise<void> {
  await hiboutikFetch("/sales/comments/", { method: "POST", body: { sale_id: saleId, comments: commentaires } })
}

export async function closeSale(saleId: number): Promise<void> {
  await hiboutikFetch("/sales/close/", { method: "POST", body: { sale_id: saleId } })
}

/** La recherche est probablement partielle : on ne garde que les ventes dont la référence est exactement celle cherchée. */
export async function searchSalesByExtRef(extRef: string): Promise<HiboutikSaleRef[]> {
  const { data } = await hiboutikFetch<HiboutikSaleRef[]>(`/sales/search/ext_ref/${encodeURIComponent(extRef)}`)
  return (Array.isArray(data) ? data : []).filter((vente) => vente?.ext_ref === extRef)
}

export async function fetchSale(saleId: number): Promise<HiboutikSale | null> {
  const { data } = await hiboutikFetch<HiboutikSale | HiboutikSale[]>(`/sales/${saleId}`)
  return (Array.isArray(data) ? data[0] : data) ?? null
}

export async function deleteSaleLineItem(lineItemId: number): Promise<void> {
  await hiboutikFetch(`/sale_line_item/${lineItemId}`, { method: "DELETE" })
}

/** Ne fonctionne que sur une vente vide et sans paiement : c'est l'outil du nettoyage, pas de l'annulation. */
export async function deleteSale(saleId: number): Promise<void> {
  await hiboutikFetch(`/sale/${saleId}`, { method: "DELETE" })
}
