import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { resendOptionsFromEnv } from "../modules/resend/lib/options"
import type { TemplateData, TemplateName } from "../modules/resend/emails"

/**
 * Demande l'envoi d'un email de la boutique.
 *
 * Le module de notification enregistre la demande puis la confie au provider du canal —
 * Resend — qui rend le template. Les subscribers rassemblent les données, cette fonction
 * les type par nom de template pour qu'on ne puisse pas envoyer « order-placed » avec les
 * données d'un autre email.
 */
export async function sendEmail<T extends TemplateName>(
  container: MedusaContainer,
  input: {
    to: string
    template: T
    data: TemplateData[T]
    /** Ce qui a déclenché l'envoi et la ressource concernée, pour l'historique. */
    trigger: string
    resource?: { id: string; type: string }
  }
): Promise<void> {
  const notifications = container.resolve(Modules.NOTIFICATION)

  await notifications.createNotifications({
    to: input.to,
    channel: "email",
    template: input.template,
    data: input.data,
    trigger_type: input.trigger,
    resource_id: input.resource?.id,
    resource_type: input.resource?.type,
  })
}

/** Lien vers le suivi d'une commande dans l'espace client — seulement pour un compte. */
export function orderUrl(order: { id: string; customer?: { has_account?: boolean } | null }): string | null {
  return order.customer?.has_account ? `${resendOptionsFromEnv().storefrontUrl}/compte/commandes/${order.id}` : null
}

export function customerName(
  customer: { first_name?: string | null; last_name?: string | null } | null | undefined,
  address: { first_name?: string | null; last_name?: string | null } | null | undefined
): string | null {
  const nom = [customer?.first_name ?? address?.first_name, customer?.last_name ?? address?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return nom || null
}
