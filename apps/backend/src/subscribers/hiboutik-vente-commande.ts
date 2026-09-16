import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { pousserVenteCommande } from "../modules/hiboutik/lib/ventes"

/*
  Commande passée — donc paiement Monetico accepté — : la vente part en caisse.

  Le bus local n'attend pas ses abonnés : la demi-douzaine d'appels à Hiboutik ne retarde ni la
  réponse au serveur de paiement ni le client. Et rien n'est relancé ici : la commande existe
  quoi qu'il arrive à la caisse ; un échec est marqué sur elle et remonte dans le rapport de
  la synchronisation de stock, d'où on peut le reporter à la main.
*/
export default async function hiboutikVenteCommande({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await pousserVenteCommande(container, event.data.id)
  } catch (erreur) {
    logger.error(
      `Vente Hiboutik : échec inattendu pour la commande ${event.data.id} — ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
}
