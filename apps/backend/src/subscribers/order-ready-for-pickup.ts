import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { customerName, orderUrl, sendEmail } from "../lib/emails"
import { lieuRetrait, optionsRetrait } from "../lib/retrait-boutique"

/*
  « Votre commande est prête à retirer », quand le marchand a préparé une commande en
  retrait boutique.

  Pour un retrait, préparer la commande dans l'admin (« Expédier des articles ») crée une
  exécution sans rien envoyer : c'est le signal que le client peut venir. Une commande
  livrée déclenche le même événement et ne reçoit rien ici — son email part plus tard,
  quand le colis est réellement en route. `no_notification` est le choix du marchand de ne
  pas prévenir, posé au clic dans l'admin.
*/
export default async function orderReadyForPickup({
  event,
  container,
}: SubscriberArgs<{ order_id: string; fulfillment_id: string; no_notification?: boolean }>): Promise<void> {
  if (event.data.no_notification) {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    filters: { id: event.data.order_id },
    fields: [
      "id",
      "display_id",
      "email",
      "shipping_methods.shipping_option_id",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "customer.has_account",
      "customer.first_name",
      "customer.last_name",
    ],
  })

  const retrait = order ? lieuRetrait(order.shipping_methods, await optionsRetrait(container)) : null
  if (!retrait) {
    return
  }

  if (!order.email) {
    logger.warn(`Email « prête à retirer » : commande ${event.data.order_id} sans adresse.`)
    return
  }

  await sendEmail(container, {
    to: order.email,
    template: "order-ready-for-pickup",
    trigger: OrderWorkflowEvents.FULFILLMENT_CREATED,
    resource: { id: order.id, type: "order" },
    data: {
      display_id: Number(order.display_id),
      customer_name: customerName(order.customer, order.shipping_address),
      lieu: { nom: retrait.nom, address_1: retrait.address_1, postal_code: retrait.postal_code, city: retrait.city },
      order_url: orderUrl(order),
    },
  })
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.FULFILLMENT_CREATED,
}
