import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Retrait en boutique : le client paie en ligne et vient chercher sa commande.
 *
 * Aucune livraison, aucun Sendcloud : l'option passe par le fournisseur manuel, dans un
 * ensemble d'expédition de type « pickup » (voir `scripts/setup-retrait-boutique.ts`).
 * C'est ce type, et non un nom ou un code, qui fait d'une commande un retrait — c'est aussi
 * lui que l'administration de Medusa lit pour proposer « Marquer comme retiré ».
 */

/** Identité de l'option, qui ne change pas quand on la renomme. */
export const RETRAIT_BOUTIQUE_CODE = "retrait-boutique"
export const RETRAIT_BOUTIQUE_NOM = "Retrait en boutique"
export const RETRAIT_BOUTIQUE_DESCRIPTION = "Gratuit · à venir chercher dès qu'elle est prête"

export type LieuRetrait = {
  nom: string | null
  address_1: string | null
  address_2: string | null
  postal_code: string | null
  city: string | null
  phone: string | null
}

/**
 * Où en est un retrait, d'après les exécutions de la commande.
 *
 * - `a_preparer` : payée, rien n'est encore prêt ;
 * - `pret` : le marchand a préparé la commande, le client peut venir ;
 * - `retire` : remise au client (« Marquer comme retiré » dans l'administration).
 */
export type StatutRetrait = "a_preparer" | "pret" | "retire"

type Execution = { canceled_at?: string | Date | null; delivered_at?: string | Date | null } | null

export function statutRetrait(executions: Execution[] | null | undefined): StatutRetrait {
  const actives = (executions ?? []).filter((e) => e && !e.canceled_at)
  if (actives.length === 0) return "a_preparer"
  return actives.every((e) => e?.delivered_at) ? "retire" : "pret"
}

/**
 * Les options de retrait, avec l'adresse de leur boutique.
 *
 * Quelques options au plus : on les lit toutes et on trie ici, plutôt que de filtrer à
 * travers trois relations dont une passe d'un module à l'autre.
 */
export async function optionsRetrait(container: MedusaContainer): Promise<Map<string, LieuRetrait>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "service_zone.fulfillment_set.type",
      "service_zone.fulfillment_set.location.name",
      "service_zone.fulfillment_set.location.address.*",
    ],
  })

  const lieux = new Map<string, LieuRetrait>()

  for (const option of options) {
    const ensemble = option.service_zone?.fulfillment_set
    if (ensemble?.type !== "pickup") continue

    const emplacement = ensemble.location as
      | { name?: string | null; address?: Partial<LieuRetrait> | null }
      | null
      | undefined
    const adresse = emplacement?.address

    lieux.set(option.id, {
      nom: emplacement?.name ?? null,
      address_1: adresse?.address_1 ?? null,
      address_2: adresse?.address_2 ?? null,
      postal_code: adresse?.postal_code ?? null,
      city: adresse?.city ?? null,
      phone: adresse?.phone ?? null,
    })
  }

  return lieux
}

/** Le lieu de retrait d'une commande, ou null si elle est livrée. */
export function lieuRetrait(
  methodes: ({ shipping_option_id?: string | null } | null)[] | null | undefined,
  options: Map<string, LieuRetrait>
): LieuRetrait | null {
  for (const methode of methodes ?? []) {
    const lieu = methode?.shipping_option_id ? options.get(methode.shipping_option_id) : undefined
    if (lieu) return lieu
  }
  return null
}
