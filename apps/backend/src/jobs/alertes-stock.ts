import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { traiterAlertesStock } from "../lib/alertes-stock"

/*
  Filet de sécurité des alertes de retour en stock, toutes les quinze minutes.

  Le subscriber prévient dans la minute, mais un événement peut manquer : perdu pendant un
  redéploiement, ou jamais émis pour un mouvement de stock qui ne passe pas par un niveau.
  Ce passage relit toutes les demandes en attente ; sans demande, il s'arrête après une
  requête.
*/
export default async function alertesStockJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await traiterAlertesStock(container)
  } catch (erreur) {
    logger.error(`Alertes de stock : passage planifié en échec. ${erreur}`)
  }
}

export const config = {
  name: "alertes-stock",
  schedule: "*/15 * * * *",
}
