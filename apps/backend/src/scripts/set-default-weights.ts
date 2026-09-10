import { Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * Poids par défaut, en grammes, emballage compris.
 *
 * La première règle dont le motif apparaît dans le titre du produit ou de la variante
 * l'emporte : les plus précises d'abord. Les valeurs sont volontairement arrondies vers
 * le haut — un colis sous-évalué est repesé en centre de tri puis refacturé, avec des
 * frais de gestion, là où une sur-évaluation ne coûte au pire qu'une tranche de plus.
 *
 * Elles restent des estimations à confronter à une balance : c'est au marchand de les
 * corriger, ce fichier n'est qu'un point de départ raisonnable.
 */
const REGLES: { motif: RegExp; grammes: number; libelle: string }[] = [
  { motif: /\b200\s?ml\b/i, grammes: 320, libelle: "E-liquide 200 ml" },
  { motif: /\b100\s?ml\b/i, grammes: 190, libelle: "E-liquide 100 ml" },
  { motif: /\b50\s?ml\b/i, grammes: 120, libelle: "E-liquide 50 ml" },
  { motif: /\b(10|30)\s?ml\b/i, grammes: 60, libelle: "E-liquide 10 à 30 ml" },
  { motif: /\b(kit|box|mod)\b/i, grammes: 450, libelle: "Kit, box ou mod" },
  { motif: /\b(tank|clearomiseur|atomiseur|pod)\b/i, grammes: 160, libelle: "Tank ou pod" },
  { motif: /\b(r[ée]sistance|coil|m[èe]che|coton)\b/i, grammes: 40, libelle: "Résistance ou coton" },
  { motif: /\b(accu|batterie|chargeur)\b/i, grammes: 180, libelle: "Accu ou chargeur" },
]

/** Appliqué aux variantes qu'aucune règle ne reconnaît. */
const PAR_DEFAUT = { grammes: 150, libelle: "Non reconnu" }

/**
 * Attribue un poids aux variantes qui n'en ont pas.
 *
 * Sans poids, rien n'est expédiable : Sendcloud refuse un colis de 0 g, le calcul des
 * frais de port échoue et le tunnel de commande se bloque au choix du transporteur.
 *
 * Prévisualise par défaut, n'écrit qu'avec l'argument `apply` — sans tirets, que la CLI
 * de Medusa interpréterait comme une de ses propres options. Les variantes qui portent
 * déjà un poids ne sont jamais touchées : une valeur pesée vaut mieux qu'une règle.
 *
 *   npx medusa exec ./src/scripts/set-default-weights.ts
 *   npx medusa exec ./src/scripts/set-default-weights.ts apply
 */
export default async function setDefaultWeights({ container, args }: ExecArgs) {
  const appliquer = (args ?? []).includes("apply")
  const product = container.resolve(Modules.PRODUCT)

  const variantes = await product.listProductVariants(
    {},
    { select: ["id", "title", "weight", "product_id"], relations: ["product"], take: null }
  )

  const aTraiter = variantes.filter((v) => !v.weight || v.weight <= 0)

  console.info(
    `${variantes.length} variantes, dont ${aTraiter.length} sans poids.\n` +
      (appliquer ? "Mode écriture.\n" : "Prévisualisation — relancer avec « apply » pour écrire.\n")
  )

  const parLibelle = new Map<string, number>()
  const misesAJour: { id: string; weight: number }[] = []

  for (const variante of aTraiter) {
    const titreProduit = (variante as { product?: { title?: string } }).product?.title ?? ""
    const cible = `${titreProduit} ${variante.title ?? ""}`

    const regle = REGLES.find((r) => r.motif.test(cible)) ?? PAR_DEFAUT
    const libelle = "libelle" in regle ? regle.libelle : PAR_DEFAUT.libelle

    parLibelle.set(libelle, (parLibelle.get(libelle) ?? 0) + 1)
    misesAJour.push({ id: variante.id, weight: regle.grammes })
  }

  for (const [libelle, nombre] of [...parLibelle.entries()].sort((a, b) => b[1] - a[1])) {
    const grammes =
      REGLES.find((r) => r.libelle === libelle)?.grammes ?? PAR_DEFAUT.grammes
    console.info(`   ${String(nombre).padStart(5)} × ${String(grammes).padStart(4)} g   ${libelle}`)
  }

  if (!appliquer || misesAJour.length === 0) {
    return
  }

  // Le module ne prend pas de tableau de modifications distinctes : on regroupe donc par
  // poids et on appelle une fois par valeur, avec la liste des variantes en selecteur.
  // Les regles etant peu nombreuses, cela fait une poignee d'appels au lieu de milliers.
  const parPoids = new Map<number, string[]>()
  for (const { id, weight } of misesAJour) {
    parPoids.set(weight, [...(parPoids.get(weight) ?? []), id])
  }

  for (const [poids, ids] of parPoids) {
    await product.updateProductVariants({ id: ids }, { weight: poids })
  }

  console.info(`\n✅ ${misesAJour.length} variantes mises à jour.`)
}
