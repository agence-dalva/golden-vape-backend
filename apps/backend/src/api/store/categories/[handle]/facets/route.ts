import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/*
  Facettes d'une catégorie : les critères de filtrage réellement disponibles, leurs valeurs, et
  le nombre de produits derrière chacune.

  GET /store/categories/liquides-3/facets?filters[Marque]=Pulp&filters[Contenance]=10ml,50ml
  → { handle, total, product_ids, facets }

  Rien n'est configuré par catégorie : les critères sont ceux que portent réellement les
  produits de la catégorie et de sa descendance. Un nouvel attribut saisi à l'administration
  apparaît donc de lui-même, et un type d'attribut sans valeur ne s'affiche jamais.

  Le calcul ne peut pas se faire côté client : à partir des vingt-quatre produits d'une page,
  on ne verrait que les valeurs présentes sur ces vingt-quatre-là.

  Tout est agrégé en base. Une première version rapatriait les produits et leurs
  caractéristiques pour compter en mémoire : 6111 lignes et 463 Ko pour rendre 2,3 Ko, ce qui
  ne se voit pas sur une base locale mais se paie sur une base distante. Les deux requêtes
  ci-dessous renvoient une soixantaine de lignes et partent en parallèle.
*/

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

/** Filtres actifs, par type d'attribut : { Marque: ["Pulp"], Contenance: ["10ml", "50ml"] }. */
function parseFilters(raw: unknown): [string, string[]][] {
  if (!raw || typeof raw !== "object") {
    return []
  }

  return Object.entries(raw as Record<string, unknown>)
    .map(([type, value]) => {
      const values = String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
      return [type, values] as [string, string[]]
    })
    .filter(([, values]) => values.length > 0)
}

// Les produits de la catégorie et de toute sa descendance. `mpath` porte le chemin des
// ancêtres : descendre l'arbre tient dans un `LIKE`, sans récursion ni requête par niveau.
//
// Les catégories inactives ou internes sont écartées, comme la boutique le fait. Le canal de
// vente, lui, n'est pas exigé : cette boutique sert des produits publiés sans lien de canal,
// et le filtrer rendrait les facettes plus strictes que la grille.
const CIBLE = `
  cible AS (
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
  ),
  valeurs AS (
    SELECT pav.product_id, at.name AS type, at.allow_multiple, pav.value
    FROM cible c
    JOIN product_attribute_value pav ON pav.product_id = c.id AND pav.deleted_at IS NULL
    JOIN attribute_type at ON at.id = pav.attribute_type_id
  )`

/**
 * Un produit passe un filtre s'il porte l'une de ses valeurs, et doit passer tous les filtres.
 * `sauf` vaut le nom d'une colonne SQL : la clause est alors neutralisée pour les lignes dont
 * c'est la facette, ce qui réalise la règle « une facette ne se compte pas elle-même » sans
 * connaître à l'avance la liste des types.
 */
function clauseFiltres(filters: [string, string[]][], sauf?: string) {
  if (filters.length === 0) {
    return { sql: "true", bindings: [] as string[] }
  }

  const bindings: string[] = []
  const sql = filters
    .map(([type, values]) => {
      const trous = values.map(() => "?").join(", ")
      const exists = `EXISTS (SELECT 1 FROM valeurs f WHERE f.product_id = c.id AND f.type = ? AND f.value IN (${trous}))`

      if (sauf) {
        bindings.push(type, type, ...values)
        return `(${sauf} = ? OR ${exists})`
      }
      bindings.push(type, ...values)
      return exists
    })
    .join(" AND ")

  return { sql, bindings }
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

  const retenus = clauseFiltres(filters)
  const parFacette = clauseFiltres(filters, "v.type")

  // `count(*) OVER ()` rend le total sur la même ligne que la page : une requête au lieu de deux.
  const pageQuery = knex.raw(
    `WITH ${CIBLE}
     SELECT c.id, count(*) OVER () AS total
     FROM cible c
     WHERE ${retenus.sql}
     ORDER BY c.title
     LIMIT ? OFFSET ?`,
    [handle, ...retenus.bindings, take, skip]
  )

  const facetsQuery = knex.raw(
    `WITH ${CIBLE}
     SELECT v.type, v.allow_multiple, v.value, count(DISTINCT v.product_id)::int AS count
     FROM valeurs v
     JOIN cible c ON c.id = v.product_id
     WHERE ${parFacette.sql}
     GROUP BY v.type, v.allow_multiple, v.value`,
    [handle, ...parFacette.bindings]
  )

  const [page, brut] = await Promise.all([pageQuery, facetsQuery])

  const lignes = page.rows as { id: string; total: string }[]
  const comptes = brut.rows as {
    type: string
    allow_multiple: boolean
    value: string
    count: number
  }[]

  const facets = new Map<string, { type: string; allow_multiple: boolean; values: { value: string; count: number }[] }>()
  for (const ligne of comptes) {
    const facette =
      facets.get(ligne.type) ??
      { type: ligne.type, allow_multiple: ligne.allow_multiple, values: [] }
    facette.values.push({ value: ligne.value, count: ligne.count })
    facets.set(ligne.type, facette)
  }

  res.json({
    handle,
    // Sans ligne renvoyée, la fenêtre `count(*) OVER ()` n'a rien à porter : le total est nul,
    // ou la page demandée dépasse la liste — le storefront distingue les deux par l'offset.
    total: Number(lignes[0]?.total ?? 0),
    // Classés par titre : la page suivante reprend où s'arrête la précédente. Le storefront
    // hydrate ces identifiants via /store/products?id[]=… pour obtenir prix et stock.
    product_ids: lignes.map((ligne) => ligne.id),
    facets: [...facets.values()]
      .map((facette) => ({
        ...facette,
        // Les plus fournies d'abord : l'ordre utile quand la liste est longue.
        values: facette.values.sort(
          (a, b) => b.count - a.count || a.value.localeCompare(b.value, "fr")
        ),
      }))
      .sort((a, b) => a.type.localeCompare(b.type, "fr")),
  })
}
