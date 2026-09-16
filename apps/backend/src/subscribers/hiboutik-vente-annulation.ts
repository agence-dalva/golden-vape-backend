import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { pousserVenteAnnulation } from "../modules/hiboutik/lib/ventes"

/* Commande annulée : si elle avait été reportée en caisse, une vente négative remet le stock. */
export default async function hiboutikVenteAnnulation({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await pousserVenteAnnulation(container, event.data.id)
  } catch (erreur) {
    logger.error(
      `Vente Hiboutik : échec inattendu à l'annulation de la commande ${event.data.id} — ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.CANCELED,
}
