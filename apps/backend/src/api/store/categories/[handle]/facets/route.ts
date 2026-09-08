import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { repondreFacettes } from "../../../../../lib/facets"

/*
  Facettes d'une catégorie : les critères de filtrage réellement disponibles, leurs valeurs, et
  le nombre de produits derrière chacune.

  GET /store/categories/liquides-3/facets?filters[marque]=Pulp&filters[contenance]=10ml,50ml
  → { handle, total, product_ids, facets }

  Rien n'est configuré par catégorie : les critères sont ceux que portent réellement les
  produits de la catégorie et de sa descendance. Un nouvel attribut saisi à l'administration
  apparaît donc de lui-même, et un type d'attribut sans valeur ne s'affiche jamais.

  Le calcul ne peut pas se faire côté client : à partir des vingt-quatre produits d'une page,
  on ne verrait que les valeurs présentes sur ces vingt-quatre-là. Tout est donc agrégé en
  base — le détail du comptage vit dans `lib/facets`, partagé avec les pages de marque.
*/

// Les produits de la catégorie et de toute sa descendance. `mpath` porte le chemin complet du
// nœud, ancêtres compris et terminé par lui-même : descendre l'arbre tient dans un `LIKE`,
// sans récursion ni requête par niveau.
//
// La comparaison porte sur les chemins et non sur l'identifiant : le chemin d'une catégorie
// commence par celui de son parent, si bien que `mpath LIKE racine.id || '%'` ne trouvait rien
// dès que la racine demandée était elle-même une sous-catégorie.
//
// Les catégories inactives ou internes sont écartées, comme la boutique le fait. Le canal de
// vente, lui, n'est pas exigé : cette boutique sert des produits publiés sans lien de canal,
// et le filtrer rendrait les facettes plus strictes que la grille.
const CIBLE = `
  cible AS (
    SELECT DISTINCT p.id, p.title, p.created_at
    FROM product_category racine
    JOIN product_category descendance
      ON (descendance.mpath = racine.mpath OR descendance.mpath LIKE racine.mpath || '.%')
     AND descendance.deleted_at IS NULL
     AND descendance.is_active = true
     AND descendance.is_internal = false
    JOIN product_category_product pcp ON pcp.product_category_id = descendance.id
    JOIN product p
      ON p.id = pcp.product_id
     AND p.status = 'published'
     AND p.deleted_at IS NULL
    WHERE racine.handle = ? AND racine.deleted_at IS NULL
  )`

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { handle } = req.params
  const { filters, limit, offset, order } = req.query as {
    filters?: unknown
    limit?: string
    offset?: string
    order?: string
  }

  const reponse = await repondreFacettes(knex, {
    cible: CIBLE,
    bindings: [handle],
    rawFilters: filters,
    limit,
    offset,
    order,
  })

  res.json({ handle, ...reponse })
}
