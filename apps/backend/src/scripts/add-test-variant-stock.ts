import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

// Ajoute un niveau de stock sur les 4 variantes de test [TEST] E-liquide Fraise 50ml —
// prérequis Medusa pour pouvoir les ajouter à un panier (POST /store/carts/:id/line-items
// échoue sinon avec "Sales channel ... is not associated with any stock location").
const STOCK_QUANTITY = 50

export default async function addTestVariantStock({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: variants } = await query.graph({
    entity: "product_variant",
    filters: { sku: [
      "TEST-ELIQUIDE-FRAISE-10ML",
      "TEST-ELIQUIDE-FRAISE-30ML",
      "TEST-ELIQUIDE-FRAISE-50ML",
      "TEST-ELIQUIDE-FRAISE-100ML",
    ] },
    fields: ["id", "sku"],
  })

  if (variants.length === 0) {
    console.log("Aucune variante de test trouvée.")
    return
  }

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })
  const locationId = (stockLocations[0] as any)?.id
  if (!locationId) {
    console.log("Aucune stock location trouvée.")
    return
  }

  const { data: links } = await query.graph({
    entity: "product_variant_inventory_item",
    filters: { variant_id: variants.map((v: any) => v.id) },
    fields: ["variant_id", "inventory_item_id"],
  })

  const inventoryLevels = links.map((link: any) => ({
    inventory_item_id: link.inventory_item_id,
    location_id: locationId,
    stocked_quantity: STOCK_QUANTITY,
  }))

  if (inventoryLevels.length === 0) {
    console.log("Aucun inventory_item lié trouvé pour ces variantes.")
    return
  }

  await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: inventoryLevels } })

  console.log(`${inventoryLevels.length} niveaux de stock créés (${STOCK_QUANTITY} unités chacun).`)
}
