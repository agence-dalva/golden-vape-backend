import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import orderPlaced from "../subscribers/order-placed"
import shipmentCreated from "../subscribers/shipment-created"
import orderCanceled from "../subscribers/order-canceled"
import passwordReset from "../subscribers/password-reset"

/**
 * Rend les emails d'une commande réelle, sans attendre les événements.
 *
 * Passe par les subscribers eux-mêmes, avec les vraies données de la base : c'est le
 * circuit complet, sauf le bus d'événements. Sans RESEND_API_KEY, les fichiers HTML
 * arrivent dans `.medusa/emails/`. Avec une clé, les emails partiraient vraiment — à
 * l'adresse du client de la commande — : il faut le demander en toutes lettres.
 *
 *   npx medusa exec ./src/scripts/preview-emails.ts commande=10
 *   npx medusa exec ./src/scripts/preview-emails.ts commande=10 envoyer=oui
 */
export default async function previewEmails({ container, args }: ExecArgs) {
  const numero = Number((args ?? []).find((a) => a.startsWith("commande="))?.slice("commande=".length))

  if (!numero) {
    console.error("❌ Préciser la commande : commande=10")
    return
  }

  if (process.env.RESEND_API_KEY && !(args ?? []).includes("envoyer=oui")) {
    console.error(
      "❌ Une clé Resend est configurée : ces emails partiraient réellement au client de la commande.\n" +
        "   Ajouter envoyer=oui pour confirmer, ou retirer RESEND_API_KEY pour un simple aperçu."
    )
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    filters: { display_id: String(numero) },
    fields: ["id", "email", "fulfillments.id", "fulfillments.canceled_at", "fulfillments.created_at"],
  })

  if (!order) {
    console.error(`❌ Aucune commande n°${numero}.`)
    return
  }

  const expedition = [...(order.fulfillments ?? [])]
    .filter((f) => f && !f.canceled_at)
    .sort((a, b) => new Date(b!.created_at).getTime() - new Date(a!.created_at).getTime())[0]

  const faux = (data: Record<string, unknown>) => ({ event: { name: "preview", data }, container } as never)

  console.info(`Commande n°${numero} → ${order.email}`)
  await orderPlaced(faux({ id: order.id }))
  console.info("  ✅ confirmation de commande")

  if (expedition) {
    await shipmentCreated(faux({ id: expedition.id }))
    console.info("  ✅ colis en route")
  } else {
    console.info("  – colis en route : aucune expédition active sur cette commande")
  }

  await orderCanceled(faux({ id: order.id }))
  console.info("  ✅ commande annulée")

  await passwordReset(faux({ entity_id: order.email, actor_type: "customer", token: "jeton-de-demonstration" }))
  console.info("  ✅ mot de passe oublié")
}
