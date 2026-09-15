import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { AuthWorkflowEvents, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendEmail } from "../lib/emails"
import { resendOptionsFromEnv } from "../modules/resend/lib/options"

/*
  Mot de passe oublié.

  Medusa génère un jeton quand le client le demande depuis la boutique, et ne fait rien
  d'autre : c'est ici que le lien part. Le jeton n'est valable qu'une heure et ne sert
  qu'à la route de mise à jour du mot de passe, avec l'email en clair pour la remplir.
*/
export default async function passwordReset({
  event,
  container,
}: SubscriberArgs<{ entity_id: string; actor_type: string; token: string }>): Promise<void> {
  const { entity_id: email, actor_type, token } = event.data

  // Les comptes d'administration ont leur propre circuit dans le dashboard.
  if (actor_type !== "customer") {
    return
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!email || !token) {
    logger.warn("Réinitialisation : événement sans email ou sans jeton.")
    return
  }

  const url = new URL("/compte/reinitialisation", resendOptionsFromEnv().storefrontUrl)
  url.searchParams.set("token", token)
  url.searchParams.set("email", email)

  await sendEmail(container, {
    to: email,
    template: "password-reset",
    trigger: AuthWorkflowEvents.PASSWORD_RESET,
    data: { reset_url: url.toString() },
  })
}

export const config: SubscriberConfig = {
  event: AuthWorkflowEvents.PASSWORD_RESET,
}
