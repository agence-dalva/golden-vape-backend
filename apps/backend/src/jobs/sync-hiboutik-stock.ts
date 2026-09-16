import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { hiboutikOptionsFromEnv } from "../modules/hiboutik/lib/options"
import { lancerSynchronisationStock, SynchronisationEnCours } from "../modules/hiboutik/lib/stock-sync-runner"

/*
  Le stock de la caisse recopié dans Medusa, toutes les dix minutes.

  Un seul appel à Hiboutik par passage — tout l'entrepôt d'un coup — et seuls les niveaux qui
  changent sont écrits. C'est ce qui fait qu'une vente en boutique, ou une réception de
  marchandise saisie en caisse, se voit sur le site sans intervention.

  La tâche vit dans le processus qui sert l'API : l'application tourne sur une seule instance,
  avec le moteur de workflow en mémoire, et sans moteur Redis chaque réplique la lancerait pour
  son compte. Sans gravité — les écritures sont absolues, un second passage ne change rien —
  mais ce serait deux fois les appels à Hiboutik : à revoir si l'on ajoute des instances.

  `HIBOUTIK_STOCK_SYNC_ENABLED` l'éteint sans la désinscrire ; l'expression cron est lue au
  chargement, comme toute la configuration.
*/

const options = hiboutikOptionsFromEnv()

export default async function synchroniserStockHiboutik(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!options.stockSync.enabled) return

  try {
    const r = await lancerSynchronisationStock(container, { dryRun: false, declencheur: "job" })
    logger.info(
      `Stock Hiboutik : ${r.lus} lignes lues, ${r.apparies} variantes appariées, ${r.crees} niveau(x) créé(s), ` +
        `${r.mis_a_jour} mis à jour, ${r.inchanges} inchangés, ${r.inconnus_hiboutik} SKU inconnus, ${r.duree_ms} ms.`
    )
    if (r.commandes_non_reportees.length) {
      logger.warn(
        `Commandes web sans vente en caisse : ${r.commandes_non_reportees.map((c) => `#${c.display_id}`).join(", ")}`
      )
    }
    for (const erreur of r.erreurs) logger.error(`Stock Hiboutik : ${erreur}`)
  } catch (erreur) {
    // Jamais relancé : le prochain passage réessaie, et le chargeur de tâches journalise déjà.
    if (erreur instanceof SynchronisationEnCours) {
      logger.warn("Stock Hiboutik : passage sauté, une synchronisation est déjà en cours.")
      return
    }
    logger.error(`Stock Hiboutik : synchronisation en échec — ${erreur instanceof Error ? erreur.message : String(erreur)}`)
  }
}

export const config = {
  name: "synchroniser-stock-hiboutik",
  schedule: { cron: options.stockSync.cron, concurrency: "forbid" as const },
}
