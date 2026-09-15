import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { customerName, orderUrl, sendEmail } from "../lib/emails"

/* Commande annulée par le marchand : le client doit le savoir, et savoir pour son argent. */
export default async function orderCanceled({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    filters: { id: event.data.id },
    fields: [
      "id",
      "display_id",
      "email",
      "total",
      "currency_code",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "customer.has_account",
      "customer.first_name",
      "customer.last_name",
      "payment_collections.status",
      "payment_collections.refunded_amount",
      "payment_collections.captured_amount",
    ],
  })

  if (!order?.email) {
    logger.warn(`Email d'annulation : commande ${event.data.id} introuvable ou sans adresse.`)
    return
  }

  // Remboursé, ou jamais encaissé : dans les deux cas le client n'a rien à attendre.
  const encaisse = (order.payment_collections ?? []).reduce((s, p) => s + Number(p?.captured_amount ?? 0), 0)
  const rembourse = (order.payment_collections ?? []).reduce((s, p) => s + Number(p?.refunded_amount ?? 0), 0)

  await sendEmail(container, {
    to: order.email,
    template: "order-canceled",
    trigger: OrderWorkflowEvents.CANCELED,
    resource: { id: order.id, type: "order" },
    data: {
      display_id: Number(order.display_id),
      customer_name: customerName(order.customer, order.shipping_address),
      total: Number(order.total ?? 0),
      currency_code: order.currency_code,
      refunded: encaisse === 0 || rembourse >= encaisse,
      order_url: orderUrl(order),
    },
  })
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.CANCELED,
}
