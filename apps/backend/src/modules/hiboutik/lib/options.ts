/*
  Source unique des options Hiboutik : le client HTTP, la synchronisation du stock, la
  remontée des ventes et la page d'administration les relisent d'ici.

  Tout ce qui écrit — dans Medusa comme dans la caisse — est éteint par défaut. Un `.env`
  fraîchement copié ne peut donc ni lancer la tâche planifiée, ni créer une vente chez le
  marchand : il faut l'avoir voulu, variable par variable.
*/

import { MedusaError } from "@medusajs/framework/utils"

export type HiboutikOptions = {
  account: string
  user: string
  apiKey: string
  /** Entrepôt dont le stock fait foi. Le compte en a deux ; le second est une autre boutique. */
  warehouseId: number
  /** Point de vente où sont enregistrées les ventes web. */
  storeId: number
  /** Type de paiement porté par ces ventes — Monetico encaisse par carte. */
  paymentType: string
  /** Client Hiboutik générique auquel rattacher les ventes web, s'il existe. */
  customerId?: number
  vendorId?: number
  /** Délai maximal d'un appel à l'API, en millisecondes. */
  timeoutMs: number
  webhookSecret?: string
  stockSync: {
    enabled: boolean
    cron: string
  }
  salesPush: {
    enabled: boolean
    /** Journalise la vente qui serait créée, sans appeler Hiboutik. */
    simulation: boolean
  }
}

export const CRON_PAR_DEFAUT = "*/10 * * * *"

function booleen(valeur: string | undefined, defaut: boolean): boolean {
  if (valeur === undefined || valeur === "") return defaut
  return valeur === "true" || valeur === "1"
}

function entier(valeur: string | undefined, defaut: number): number {
  const nombre = Number(valeur)
  return valeur && Number.isInteger(nombre) ? nombre : defaut
}

function entierOptionnel(valeur: string | undefined): number | undefined {
  const nombre = Number(valeur)
  return valeur && Number.isInteger(nombre) ? nombre : undefined
}

export function hiboutikOptionsFromEnv(): HiboutikOptions {
  return {
    account: process.env.HIBOUTIK_ACCOUNT ?? "",
    user: process.env.HIBOUTIK_USER ?? "",
    apiKey: process.env.HIBOUTIK_API_KEY ?? "",
    warehouseId: entier(process.env.HIBOUTIK_WAREHOUSE_ID, 1),
    storeId: entier(process.env.HIBOUTIK_STORE_ID, 1),
    paymentType: process.env.HIBOUTIK_PAYMENT_TYPE || "CB",
    customerId: entierOptionnel(process.env.HIBOUTIK_CUSTOMER_ID),
    vendorId: entierOptionnel(process.env.HIBOUTIK_VENDOR_ID),
    timeoutMs: entier(process.env.HIBOUTIK_TIMEOUT_MS, 20_000),
    webhookSecret: process.env.HIBOUTIK_WEBHOOK_SECRET || undefined,
    stockSync: {
      enabled: booleen(process.env.HIBOUTIK_STOCK_SYNC_ENABLED, false),
      cron: process.env.HIBOUTIK_STOCK_SYNC_CRON || CRON_PAR_DEFAUT,
    },
    salesPush: {
      enabled: booleen(process.env.HIBOUTIK_SALES_PUSH_ENABLED, false),
      simulation: booleen(process.env.HIBOUTIK_SALES_PUSH_SIMULATION, false),
    },
  }
}

/** Les trois identifiants sans lesquels aucun appel n'est possible. */
export function exigerIdentifiantsHiboutik(options: HiboutikOptions): void {
  if (!options.account || !options.user || !options.apiKey) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Configuration Hiboutik manquante : HIBOUTIK_ACCOUNT, HIBOUTIK_USER et HIBOUTIK_API_KEY doivent être définis"
    )
  }
}
