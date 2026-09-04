import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/*
  Marques présentes dans chaque catégorie racine, pour la barre de navigation.

  GET /store/catalog/category-brands
  → { categories: { "diy-20": [{ value: "Pulp", count: 4, image_url: "…" }, …], … } }

  Une marque est « présente dans DIY » si elle est portée par un produit de DIY ou de l'une de
  ses sous-catégories. `mpath` porte le chemin complet du nœud : la descendance se compare en
  une jointure, sans récursion ni requête par catégorie.

  Toutes les catégories sont traitées en une seule requête, parce que cette barre est rendue sur
  chaque page du site : la calculer catégorie par catégorie multiplierait le coût par sept.
*/

const MARQUE = "Marque"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const { rows } = await knex.raw(
    `
    SELECT racine.handle, pav.value, max(avi.image_url) AS image_url,
           count(DISTINCT p.id)::int AS count
    FROM product_category racine
    JOIN product_category descendance
      ON (descendance.mpath = racine.mpath OR descendance.mpath LIKE racine.mpath || '.%')
     AND descendance.deleted_at IS NULL
     AND descendance.is_active = true
     AND descendance.is_internal = false
    JOIN product_category_product pcp ON pcp.product_category_id = descendance.id
    JOIN product p
      ON p.id = pcp.product_id AND p.status = 'published' AND p.deleted_at IS NULL
    JOIN product_attribute_value pav ON pav.product_id = p.id AND pav.deleted_at IS NULL
    JOIN attribute_type at ON at.id = pav.attribute_type_id AND at.name = ?
    -- Le logo est facultatif : une marque portée par des produits sans avoir été illustrée à
    -- l'administration reste listée, le menu affiche alors son initiale.
    LEFT JOIN attribute_value_image avi
      ON avi.value = pav.value
     AND avi.attribute_type_id = pav.attribute_type_id
     AND avi.deleted_at IS NULL
    WHERE racine.parent_category_id IS NULL
      AND racine.deleted_at IS NULL
      AND racine.is_active = true
      AND racine.is_internal = false
    GROUP BY racine.handle, pav.value
    ORDER BY racine.handle, count DESC, pav.value
    `,
    [MARQUE]
  )

  const categories: Record<
    string,
    { value: string; count: number; image_url: string | null }[]
  > = {}
  for (const row of rows as {
    handle: string
    value: string
    image_url: string | null
    count: number
  }[]) {
    ;(categories[row.handle] ??= []).push({
      value: row.value,
      count: row.count,
      image_url: row.image_url,
    })
  }

  res.json({ categories })
}
