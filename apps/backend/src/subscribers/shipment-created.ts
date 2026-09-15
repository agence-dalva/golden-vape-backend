import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, FulfillmentWorkflowEvents } from "@medusajs/framework/utils"
import { customerName, orderUrl, sendEmail } from "../lib/emails"

/*
  « Votre colis est en route », quand l'expédition est marquée expédiée — par le webhook
  Sendcloud au premier scan du transporteur, ou par le marchand dans l'admin.

  L'événement porte l'identifiant de l'expédition ; la commande, l'adresse et le suivi se
  lisent depuis elle. `no_notification` est le choix du marchand de ne pas prévenir, posé
  au clic dans l'admin.
*/
export default async function shipmentCreated({
  event,
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>): Promise<void> {
  if (event.data.no_notification) {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    data: [expedition],
  } = await query.graph({
    entity: "fulfillment",
    filters: { id: event.data.id },
    fields: [
      "id",
      "labels.tracking_number",
      "labels.tracking_url",
      "order.id",
      "order.display_id",
      "order.email",
      "order.shipping_methods.name",
      "order.shipping_methods.data",
      "order.shipping_address.first_name",
      "order.shipping_address.last_name",
      "order.customer.has_account",
      "order.customer.first_name",
      "order.customer.last_name",
    ],
  })

  const order = expedition?.order

  if (!order?.email) {
    logger.warn(`Email d'expédition : expédition ${event.data.id} sans commande ou sans adresse.`)
    return
  }

  const suivi = expedition.labels?.[0]
  const livraison = order.shipping_methods?.[0]
  const donneesLivraison = (livraison?.data ?? {}) as { service_point_name?: string }

  await sendEmail(container, {
    to: order.email,
    template: "shipment-created",
    trigger: FulfillmentWorkflowEvents.SHIPMENT_CREATED,
    resource: { id: order.id, type: "order" },
    data: {
      display_id: Number(order.display_id),
      customer_name: customerName(order.customer, order.shipping_address),
      shipping_method: livraison?.name ?? null,
      service_point_name: donneesLivraison.service_point_name ?? null,
      tracking_number: suivi?.tracking_number || null,
      tracking_url: suivi?.tracking_url || null,
      order_url: orderUrl(order),
    },
  })
}

export const config: SubscriberConfig = {
  event: FulfillmentWorkflowEvents.SHIPMENT_CREATED,
}
