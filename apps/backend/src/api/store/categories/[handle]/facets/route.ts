import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/*
  Facettes d'une catégorie : les critères de filtrage réellement disponibles, leurs valeurs, et
  le nombre de produits derrière chacune.

  GET /store/categories/liquides-3/facets?filters[Marque]=Pulp&filters[Contenance]=10ml,50ml
  → { category, total, product_ids, facets }

  Rien n'est configuré par catégorie : les critères sont ceux que portent réellement les
  produits de la catégorie et de sa descendance. Un nouvel attribut saisi à l'administration
  apparaît donc de lui-même, et un type d'attribut sans valeur ne s'affiche jamais.

  Le calcul ne peut pas se faire côté client : à partir des vingt-quatre produits d'une page,
  on ne verrait que les valeurs présentes sur ces vingt-quatre-là.
*/

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

type Row = {
  id: string
  title: string
  type: string | null
  allow_multiple: boolean | null
  value: string | null
}

/** Filtres actifs, par type d'attribut : { Marque: ["Pulp"], Contenance: ["10ml", "50ml"] }. */
function parseFilters(raw: unknown): Map<string, Set<string>> {
  const filters = new Map<string, Set<string>>()
  if (!raw || typeof raw !== "object") {
    return filters
  }

  for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
    const values = String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)

    if (values.length > 0) {
      filters.set(type, new Set(values))
    }
  }
  return filters
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { handle } = req.params
  const { filters: rawFilters, limit, offset } = req.query as {
    filters?: unknown
    limit?: string
    offset?: string
  }

  const filters = parseFilters(rawFilters)
  const take = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
  const skip = Math.max(0, Number(offset) || 0)

  /*
    `mpath` porte le chemin complet des ancêtres de chaque catégorie : descendre l'arbre tient
    donc dans un `LIKE`, quelle que soit la profondeur, sans récursion ni requête par niveau.

    Les catégories inactives ou internes sont écartées — la boutique ne les expose pas non plus.

    Le canal de vente, en revanche, n'est pas filtré : cette boutique sert des produits publiés
    sans lien de canal, et l'exiger rendrait les facettes plus strictes que la grille. Si un
    jour la production masque des produits publiés faute de canal, les comptes seront
    optimistes de ces produits-là.
  */
  const { rows } = await knex.raw(
    `
    WITH cible AS (
      SELECT DISTINCT p.id, p.title
      FROM product_category racine
      JOIN product_category descendance
        ON descendance.mpath LIKE racine.id || '%'
       AND descendance.deleted_at IS NULL
       AND descendance.is_active = true
       AND descendance.is_internal = false
      JOIN product_category_product pcp ON pcp.product_category_id = descendance.id
      JOIN product p
        ON p.id = pcp.product_id
       AND p.status = 'published'
       AND p.deleted_at IS NULL
      WHERE racine.handle = ? AND racine.deleted_at IS NULL
    )
    SELECT c.id, c.title, at.name AS type, at.allow_multiple, pav.value
    FROM cible c
    LEFT JOIN product_attribute_value pav ON pav.product_id = c.id
    LEFT JOIN attribute_type at ON at.id = pav.attribute_type_id
    ORDER BY c.title, c.id
    `,
    [handle]
  )

  // Un produit sans caractéristique remonte quand même, avec des colonnes nulles : il compte
  // dans le total et reste affiché tant qu'aucun filtre n'est actif.
  const products = new Map<string, Map<string, Set<string>>>()
  const multiValued = new Map<string, boolean>()
  const order: string[] = []

  for (const row of rows as Row[]) {
    let attributes = products.get(row.id)
    if (!attributes) {
      attributes = new Map()
      products.set(row.id, attributes)
      order.push(row.id)
    }
    if (!row.type || !row.value) {
      continue
    }
    multiValued.set(row.type, Boolean(row.allow_multiple))

    const values = attributes.get(row.type) ?? new Set<string>()
    values.add(row.value)
    attributes.set(row.type, values)
  }

  /** Un produit passe un filtre s'il porte l'une de ses valeurs ; il doit passer tous les filtres. */
  const passes = (id: string, ignored?: string) => {
    const attributes = products.get(id)
    for (const [type, wanted] of filters) {
      if (type === ignored) {
        continue
      }
      const held = attributes?.get(type)
      if (!held || ![...wanted].some((value) => held.has(value))) {
        return false
      }
    }
    return true
  }

  const matching = order.filter((id) => passes(id))

  /*
    Une facette ne se compte pas elle-même : ses valeurs sont dénombrées en appliquant tous les
    autres filtres, mais pas le sien. Sans cela, cocher « Pulp » ferait tomber les autres
    marques à zéro et le client ne pourrait jamais en ajouter une seconde.
  */
  const facets = [...multiValued.entries()].map(([type, allow_multiple]) => {
    const counts = new Map<string, number>()

    for (const id of order) {
      if (!passes(id, type)) {
        continue
      }
      for (const value of products.get(id)?.get(type) ?? []) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }

    return {
      type,
      allow_multiple,
      // Les plus fournies d'abord : c'est l'ordre utile quand la liste est longue.
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr")),
    }
  })

  res.json({
    handle,
    total: matching.length,
    // Classés par titre, comme la requête les renvoie : la page suivante reprend où s'arrête
    // la précédente. Le storefront hydrate ces identifiants via /store/products?id[]=…
    product_ids: matching.slice(skip, skip + take),
    facets: facets
      .filter((facet) => facet.values.length > 0)
      .sort((a, b) => a.type.localeCompare(b.type, "fr")),
  })
}
