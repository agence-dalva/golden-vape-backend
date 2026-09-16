import type { ICacheService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Compteurs, Ecart } from "./stock-diff"

/*
  Le compte rendu d'une synchronisation, tel que le voient la tâche planifiée dans le journal,
  la page d'administration et le script en ligne de commande. Un seul type pour les trois :
  ce qu'on lit à l'écran est exactement ce qui a été fait.
*/

export type CommandeNonReportee = {
  id: string
  display_id: number
  created_at: string
  status: string
  type: "commande" | "annulation"
  statut_hiboutik: string | null
}

export type RapportStock = Compteurs & {
  simulation: boolean
  declencheur: "job" | "admin" | "cli"
  debut: string
  duree_ms: number
  location_id: string | null
  /** Tronqués pour le cache et l'écran ; le script en ligne de commande reçoit la liste entière. */
  ecarts: Ecart[]
  ecarts_total: number
  inconnus: string[]
  negatifs: string[]
  commandes_non_reportees: CommandeNonReportee[]
  /** La remontée des ventes est désactivée : la liste ci-dessus n'a pas de sens. */
  remontee_desactivee: boolean
  erreurs: string[]
}

export const CLE_DERNIER_RAPPORT = "hiboutik:stock-sync:dernier-rapport"
export const TTL_DERNIER_RAPPORT = 7 * 24 * 3600
export const ECARTS_CONSERVES = 500

/**
 * Garde le dernier rapport pour la page d'administration. Un cache muet n'y change rien :
 * la synchronisation a déjà eu lieu, elle ne doit pas passer pour échouée.
 */
export async function enregistrerDernierRapport(container: MedusaContainer, rapport: RapportStock): Promise<void> {
  const cache = container.resolve<ICacheService>(Modules.CACHE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await cache.set(
      CLE_DERNIER_RAPPORT,
      { ...rapport, ecarts: rapport.ecarts.slice(0, ECARTS_CONSERVES) },
      TTL_DERNIER_RAPPORT
    )
  } catch (erreur) {
    logger.warn(
      `Rapport de stock Hiboutik non conservé : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
  }
}

export async function lireDernierRapport(container: MedusaContainer): Promise<RapportStock | null> {
  const cache = container.resolve<ICacheService>(Modules.CACHE)
  try {
    return await cache.get<RapportStock>(CLE_DERNIER_RAPPORT)
  } catch {
    return null
  }
}
