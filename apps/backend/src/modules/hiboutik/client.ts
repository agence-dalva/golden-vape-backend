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

const PAGE_SIZE = 250

function getConfig() {
  const account = process.env.HIBOUTIK_ACCOUNT
  const user = process.env.HIBOUTIK_USER
  const apiKey = process.env.HIBOUTIK_API_KEY

  if (!account || !user || !apiKey) {
    throw new Error(
      "Configuration Hiboutik manquante : HIBOUTIK_ACCOUNT, HIBOUTIK_USER et HIBOUTIK_API_KEY doivent être définis"
    )
  }

  return { account, user, apiKey }
}

function authHeaderFor({ user, apiKey }: { user: string; apiKey: string }) {
  return "Basic " + Buffer.from(`${user}:${apiKey}`).toString("base64")
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
  const config = getConfig()
  const baseUrl = `https://${config.account}.hiboutik.com/api`

  const products: HiboutikProduct[] = []
  let page = 1
  let totalPages: number | null = null

  while (true) {
    const res = await fetch(`${baseUrl}/products/?p=${page}`, {
      headers: {
        Authorization: authHeaderFor(config),
        Accept: "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Hiboutik API a répondu ${res.status} sur /products/?p=${page}`)
    }

    if (totalPages === null) {
      totalPages = totalPagesFromContentRange(res.headers.get("content-range"))
    }

    const batch = (await res.json()) as HiboutikProduct[]
    if (!Array.isArray(batch) || batch.length === 0) break

    products.push(...batch)

    if (totalPages !== null ? page >= totalPages : batch.length < PAGE_SIZE) break
    page += 1
  }

  return products.filter((p) => !!p.product_barcode?.trim())
}

// Retourne une map category_id -> category_name pour affichage indicatif dans l'aperçu
export async function fetchHiboutikCategories(): Promise<Map<number, string>> {
  const config = getConfig()
  const baseUrl = `https://${config.account}.hiboutik.com/api`

  const res = await fetch(`${baseUrl}/categories`, {
    headers: {
      Authorization: authHeaderFor(config),
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    throw new Error(`Hiboutik API a répondu ${res.status} sur /categories`)
  }

  const categories = (await res.json()) as HiboutikCategory[]
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
  const config = getConfig()
  const baseUrl = `https://${config.account}.hiboutik.com/api`

  const res = await fetch(`${baseUrl}/products/${productId}`, {
    headers: {
      Authorization: authHeaderFor(config),
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    throw new Error(`Hiboutik API a répondu ${res.status} sur /products/${productId}`)
  }

  const data = (await res.json()) as {
    product_size_details?: HiboutikSizeDetail[]
    stock_available?: HiboutikStockEntry[]
  }[]
  const detail = data[0]

  const stockBySize = new Map<number, number>()
  for (const entry of detail?.stock_available || []) {
    stockBySize.set(entry.product_size, (stockBySize.get(entry.product_size) || 0) + entry.stock_available)
  }

  return {
    sizeDetails: detail?.product_size_details || [],
    stockBySize,
  }
}
