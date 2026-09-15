import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { customerName, orderUrl, sendEmail } from "../lib/emails"

/*
  Confirmation de commande, au paiement validé.

  Le récapitulatif complet — articles, totaux, livraison — pour que le client n'ait pas à
  revenir sur le site pour savoir ce qu'il a commandé. Le lien de suivi n'apparaît que si
  la commande est rattachée à un compte : un invité n'a pas d'espace où aller.
*/
export default async function orderPlaced({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
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
      "created_at",
      "currency_code",
      "email",
      "item_total",
      "shipping_total",
      "tax_total",
      "discount_total",
      "total",
      // Lignes et méthodes entières, jamais champ par champ : Medusa recalcule les totaux
      // à partir d'elles, et une ligne sans ses taxes ramène tout à zéro.
      "items.*",
      "items.tax_lines.*",
      "items.adjustments.*",
      "shipping_methods.*",
      "shipping_methods.tax_lines.*",
      "shipping_methods.adjustments.*",
      "shipping_address.*",
      "customer.has_account",
      "customer.first_name",
      "customer.last_name",
    ],
  })

  if (!order?.email) {
    logger.warn(`Email de confirmation : commande ${event.data.id} introuvable ou sans adresse.`)
    return
  }

  const livraison = order.shipping_methods?.[0]
  const donneesLivraison = (livraison?.data ?? {}) as { service_point_name?: string }

  await sendEmail(container, {
    to: order.email,
    template: "order-placed",
    trigger: OrderWorkflowEvents.PLACED,
    resource: { id: order.id, type: "order" },
    data: {
      display_id: Number(order.display_id),
      created_at: String(order.created_at),
      currency_code: order.currency_code,
      customer_name: customerName(order.customer, order.shipping_address),
      items: (order.items ?? []).map((item) => ({
        title: item?.title ?? "",
        variant_title: item?.variant_title ?? null,
        quantity: Number(item?.quantity ?? 0),
        total: Number(item?.total ?? 0),
      })),
      item_total: Number(order.item_total ?? 0),
      shipping_total: Number(order.shipping_total ?? 0),
      tax_total: Number(order.tax_total ?? 0),
      discount_total: Number(order.discount_total ?? 0),
      total: Number(order.total ?? 0),
      shipping_method: livraison?.name ?? null,
      service_point_name: donneesLivraison.service_point_name ?? null,
      shipping_address: order.shipping_address
        ? {
            first_name: order.shipping_address.first_name,
            last_name: order.shipping_address.last_name,
            address_1: order.shipping_address.address_1,
            address_2: order.shipping_address.address_2,
            postal_code: order.shipping_address.postal_code,
            city: order.shipping_address.city,
          }
        : null,
      order_url: orderUrl(order),
    },
  })
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
}
