import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { repondreFacettes } from "../../../../../lib/facets"

/*
  Facettes d'une marque : mêmes critères, même comptage et même pagination que pour une
  rubrique, sur l'ensemble des produits qui portent cette marque.

  GET /store/brands/Pulp/facets?filters[contenance]=10ml,50ml&order=-created_at
  → { value, total, product_ids, facets }

  La page d'une marque montrait jusqu'ici une grille sans aucun filtre, alors qu'une marque
  fournie compte plusieurs centaines de références. Elle emprunte désormais le panneau des
  rubriques, avec ce que cela suppose derrière : les valeurs réellement présentes, comptées, et
  la règle « une facette ne se compte pas elle-même ».

  La marque elle-même reste une facette comme une autre : elle n'a qu'une valeur ici, et le
  panneau ne montre pas les critères à valeur unique — c'est le titre de la page qui la porte.

  :value doit être encodé côté client, « A%26L » pour « A&L ».
*/

// Les produits qui portent cette valeur pour l'attribut « Marque ». Le nom du type est écrit
// ici plutôt que reçu en paramètre : c'est la page des marques, pas un filtre générique.
const CIBLE = `
  cible AS (
    SELECT DISTINCT p.id, p.title, p.created_at
    FROM product_attribute_value pav
    JOIN attribute_type at
      ON at.id = pav.attribute_type_id
     AND at.name = 'Marque'
    JOIN product p
      ON p.id = pav.product_id
     AND p.status = 'published'
     AND p.deleted_at IS NULL
    WHERE pav.value = ? AND pav.deleted_at IS NULL
  )`

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const { value } = req.params
  const { filters, limit, offset, order } = req.query as {
    filters?: unknown
    limit?: string
    offset?: string
    order?: string
  }

  const reponse = await repondreFacettes(knex, {
    cible: CIBLE,
    bindings: [value],
    rawFilters: filters,
    limit,
    offset,
    order,
  })

  res.json({ value, ...reponse })
}
