import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, InventoryEvents } from "@medusajs/framework/utils"
import { traiterAlertesStock } from "../lib/alertes-stock"
import { ALERTE_STOCK_MODULE } from "../modules/alerte-stock"
import type AlerteStockModuleService from "../modules/alerte-stock/service"

/*
  Un niveau de stock vient de changer : les clients qui attendaient la déclinaison sont
  prévenus dans la foulée.

  La synchro Hiboutik peut écrire des centaines de niveaux d'un coup, donc autant
  d'événements : chacun commence par vérifier qu'une demande attend, ce qui coûte une
  requête et suffit presque toujours à s'arrêter là.

  Une réservation supprimée — commande annulée — libère du stock sans toucher au niveau.
  Elle n'existe plus quand l'événement arrive : on repasse alors sur toutes les demandes.
*/
export default async function alertesStock({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const alertes = container.resolve<AlerteStockModuleService>(ALERTE_STOCK_MODULE)
  const [uneDemande] = await alertes.listAlerteStocks({ notified_at: null }, { take: 1, select: ["id"] })
  if (!uneDemande) return

  if (event.name === InventoryEvents.RESERVATION_ITEM_DELETED) {
    await traiterAlertesStock(container)
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [niveau] } = await query.graph({
    entity: "inventory_level",
    filters: { id: event.data.id },
    fields: ["inventory_item.variants.id"],
  })

  const variantIds = ((niveau?.inventory_item as { variants?: ({ id: string } | null)[] } | null)?.variants ?? [])
    .map((v) => v?.id)
    .filter((id): id is string => Boolean(id))

  if (variantIds.length > 0) {
    await traiterAlertesStock(container, { variantIds })
  }
}

export const config: SubscriberConfig = {
  event: [
    InventoryEvents.INVENTORY_LEVEL_CREATED,
    InventoryEvents.INVENTORY_LEVEL_UPDATED,
    InventoryEvents.RESERVATION_ITEM_DELETED,
  ],
}
