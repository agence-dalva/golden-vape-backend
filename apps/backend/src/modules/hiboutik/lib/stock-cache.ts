import { fetchStockAvailable } from "../client"
import { indexerStockHiboutik, type LigneHiboutik } from "./stock-diff"
import { hiboutikOptionsFromEnv } from "./options"

/*
  La dernière liste de stock lue chez Hiboutik, gardée en mémoire du processus.

  Elle sert à deux choses : au tirage, qui la lit toutes les dix minutes de toute façon ; et à
  la remontée d'une vente, qui a besoin de traduire un SKU en identifiants Hiboutik
  (produit, déclinaison). Grâce à ce partage, une commande ne coûte aucune lecture — la carte
  vient du dernier tirage. Si un SKU y manque (référence créée en caisse depuis), on relit une
  fois, à condition que la liste ait plus d'une minute : une rafale de commandes sur une
  référence inconnue ne doit pas se transformer en rafale d'appels.
*/

const FRAICHEUR_MAX_MS = 30 * 60 * 1000
const RELECTURE_MIN_MS = 60 * 1000

let liste: { parSku: Map<string, LigneHiboutik>; lueA: number } | null = null

export function memoriserStockHiboutik(parSku: Map<string, LigneHiboutik>): void {
  liste = { parSku, lueA: Date.now() }
}

async function relire(): Promise<Map<string, LigneHiboutik>> {
  const lignes = await fetchStockAvailable(hiboutikOptionsFromEnv().warehouseId)
  const { parSku } = indexerStockHiboutik(lignes)
  memoriserStockHiboutik(parSku)
  return parSku
}

/** La correspondance SKU → déclinaison Hiboutik pour les SKU demandés, du cache si possible. */
export async function obtenirCarteSku(skus: string[]): Promise<Map<string, LigneHiboutik>> {
  const maintenant = Date.now()
  let parSku = liste && maintenant - liste.lueA < FRAICHEUR_MAX_MS ? liste.parSku : await relire()

  const manquants = skus.filter((sku) => !parSku.has(sku))
  if (manquants.length > 0 && liste && maintenant - liste.lueA > RELECTURE_MIN_MS) {
    parSku = await relire()
  }
  return parSku
}
