import type { MedusaContainer } from "@medusajs/framework/types"
import { synchroniserStockHiboutikWorkflow } from "../../../workflows/sync-hiboutik-stock"
import { enregistrerDernierRapport, type RapportStock } from "./rapport-stock"

/*
  Le point d'entrée unique de la synchronisation, pour la tâche planifiée, le bouton de la page
  d'administration et le script en ligne de commande : le rapport est complété et conservé au
  même endroit, et deux passages ne peuvent pas se chevaucher dans un même processus.

  Le verrou est une simple variable : l'application tourne sur une seule instance, avec le
  moteur de workflow en mémoire, et c'est le seul verrou honnête dans ces conditions. L'option
  `concurrency: "forbid"` de la tâche ne protège que la tâche d'elle-même, pas du bouton.
*/

let enCours: Promise<RapportStock> | null = null

export class SynchronisationEnCours extends Error {
  constructor() {
    super("Une synchronisation du stock Hiboutik est déjà en cours")
    this.name = "SynchronisationEnCours"
  }
}

export async function lancerSynchronisationStock(
  container: MedusaContainer,
  entree: { dryRun: boolean; declencheur: RapportStock["declencheur"]; joursReconciliation?: number }
): Promise<RapportStock> {
  if (enCours) throw new SynchronisationEnCours()

  const debut = Date.now()
  enCours = (async () => {
    const { result } = await synchroniserStockHiboutikWorkflow(container).run({
      input: { dryRun: entree.dryRun, joursReconciliation: entree.joursReconciliation },
    })
    const rapport: RapportStock = {
      ...result,
      declencheur: entree.declencheur,
      debut: new Date(debut).toISOString(),
      duree_ms: Date.now() - debut,
    }
    await enregistrerDernierRapport(container, rapport)
    return rapport
  })()

  try {
    return await enCours
  } finally {
    enCours = null
  }
}
