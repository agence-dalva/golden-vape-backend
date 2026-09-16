import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { fetchStockAvailable } from "../modules/hiboutik/client"
import { exigerIdentifiantsHiboutik, hiboutikOptionsFromEnv } from "../modules/hiboutik/lib/options"
import type { CommandeNonReportee, RapportStock } from "../modules/hiboutik/lib/rapport-stock"
import { memoriserStockHiboutik } from "../modules/hiboutik/lib/stock-cache"
import {
  calculerEcarts,
  indexerStockHiboutik,
  type LigneHiboutik,
  type NiveauAEcrire,
  type ResultatDiff,
  type VarianteLue,
} from "../modules/hiboutik/lib/stock-diff"

/*
  Le stock de la caisse recopié dans Medusa.

  Une lecture chez Hiboutik — tout l'entrepôt en un appel —, une lecture des variantes et de
  leurs niveaux dans Medusa, le calcul des écarts (voir `stock-diff.ts` pour l'invariant), puis
  l'écriture des seuls niveaux qui changent, par lots. Rien d'autre n'est touché : ni produit,
  ni variante, ni réservation — le cache de la recherche n'a donc rien à périmer.

  Pas de compensation sur l'écriture. Chaque niveau écrit est une valeur absolue, re-dérivée au
  tour suivant : un lot en échec laisse les précédents justes et le prochain passage rattrape
  le reste. Annuler des niveaux déjà justes serait faire pire que l'échec.

  Les données passent d'une étape à l'autre en JSON : des tableaux, jamais de `Map`.
*/

export type EntreeSynchroStock = {
  dryRun?: boolean
  /** Fenêtre, en jours, des commandes dont on vérifie la remontée en caisse. */
  joursReconciliation?: number
}

const LOT = 200
const PAGE = 500

const lireStockHiboutikStep = createStep("lire-stock-hiboutik", async () => {
  const options = hiboutikOptionsFromEnv()
  exigerIdentifiantsHiboutik(options)
  const lignes = await fetchStockAvailable(options.warehouseId)
  const { parSku, doublons } = indexerStockHiboutik(lignes)
  memoriserStockHiboutik(parSku)
  return new StepResponse({ lignes: [...parSku.values()], lus: lignes.length, doublons })
})

const lireNiveauxMedusaStep = createStep("lire-niveaux-medusa", async (_, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: lieux } = await query.graph({ entity: "stock_location", fields: ["id"] })
  const locationId: string | null = lieux[0]?.id ?? null

  const variantes: VarianteLue[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "title",
        "manage_inventory",
        "product.title",
        "inventory_items.inventory_item_id",
        "inventory_items.inventory.location_levels.id",
        "inventory_items.inventory.location_levels.location_id",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
      pagination: { take: PAGE, skip, order: { id: "ASC" } },
    })
    for (const v of data as any[]) {
      variantes.push({
        id: v.id,
        sku: v.sku ?? null,
        titre: [v.product?.title, v.title].filter(Boolean).join(" / "),
        manage_inventory: !!v.manage_inventory,
        inventory_items: ((v.inventory_items ?? []) as any[])
          .filter((lien) => lien?.inventory_item_id)
          .map((lien) => ({
            inventory_item_id: lien.inventory_item_id as string,
            location_levels: ((lien.inventory?.location_levels ?? []) as any[]).map((n) => ({
              id: n.id as string,
              location_id: n.location_id as string,
              stocked_quantity: Number(n.stocked_quantity) || 0,
              reserved_quantity: Number(n.reserved_quantity) || 0,
            })),
          })),
      })
    }
    if (data.length < PAGE) break
  }

  return new StepResponse({ locationId, variantes })
})

const calculerEcartsStep = createStep(
  "calculer-ecarts",
  async (entree: { lignes: LigneHiboutik[]; lus: number; doublons: number; locationId: string | null; variantes: VarianteLue[] }) => {
    if (!entree.locationId) {
      const vide = calculerEcarts(new Map(), [], "", entree.lus, entree.doublons)
      return new StepResponse({ ...vide, sansLieu: true })
    }
    const parSku = new Map(entree.lignes.map((l) => [l.sku, l]))
    return new StepResponse({
      ...calculerEcarts(parSku, entree.variantes, entree.locationId, entree.lus, entree.doublons),
      sansLieu: false,
    })
  }
)

const appliquerNiveauxStep = createStep(
  "appliquer-niveaux",
  async (entree: { creations: NiveauAEcrire[]; misesAJour: NiveauAEcrire[]; dryRun: boolean }, { container }) => {
    const erreurs: string[] = []
    if (entree.dryRun) return new StepResponse({ erreurs })

    const lots: { create: NiveauAEcrire[]; update: NiveauAEcrire[] }[] = []
    for (let i = 0; i < entree.creations.length; i += LOT) lots.push({ create: entree.creations.slice(i, i + LOT), update: [] })
    for (let i = 0; i < entree.misesAJour.length; i += LOT) lots.push({ create: [], update: entree.misesAJour.slice(i, i + LOT) })

    for (const [index, lot] of lots.entries()) {
      try {
        await batchInventoryItemLevelsWorkflow(container).run({ input: lot })
      } catch (erreur) {
        erreurs.push(
          `lot ${index + 1}/${lots.length} (${lot.create.length} création(s), ${lot.update.length} mise(s) à jour) : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`
        )
      }
    }
    return new StepResponse({ erreurs })
  }
)

/*
  Les commandes web qui n'ont pas donné lieu à une vente en caisse. Le bus d'événements local
  ne rejoue rien : si la remontée a échoué, seule cette liste le dira. Les métadonnées ne se
  filtrent pas en requête, on lit la fenêtre entière et on trie ici — quelques centaines de
  commandes au plus pour cette boutique.
*/
const listerCommandesNonReporteesStep = createStep(
  "lister-commandes-non-reportees",
  async (entree: { jours: number }, { container }) => {
    const options = hiboutikOptionsFromEnv()
    if (!options.salesPush.enabled) {
      return new StepResponse({ commandes: [] as CommandeNonReportee[], remonteeDesactivee: true })
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const depuis = new Date(Date.now() - entree.jours * 86_400_000).toISOString()
    const { data } = await query.graph({
      entity: "order",
      filters: { created_at: { $gte: depuis } },
      fields: ["id", "display_id", "status", "created_at", "metadata"],
      pagination: { take: 500, skip: 0, order: { created_at: "DESC" } },
    })

    const commandes: CommandeNonReportee[] = []
    for (const commande of data as any[]) {
      const marqueur = commande.metadata?.hiboutik as { status?: string; annulation?: { status?: string } } | undefined
      const base = {
        id: commande.id as string,
        display_id: Number(commande.display_id),
        created_at: String(commande.created_at),
        status: String(commande.status),
        statut_hiboutik: marqueur?.status ?? null,
      }
      if (commande.status === "canceled") {
        if (marqueur?.status === "poussee" && marqueur.annulation?.status !== "poussee") {
          commandes.push({ ...base, type: "annulation" })
        }
      } else if (marqueur?.status !== "poussee") {
        commandes.push({ ...base, type: "commande" })
      }
    }
    return new StepResponse({ commandes, remonteeDesactivee: false })
  }
)

type Sortie = Omit<RapportStock, "declencheur" | "debut" | "duree_ms">

export const synchroniserStockHiboutikWorkflow = createWorkflow(
  "synchroniser-stock-hiboutik",
  (input: EntreeSynchroStock) => {
    const hiboutik = lireStockHiboutikStep()
    const medusa = lireNiveauxMedusaStep()
    const diff = calculerEcartsStep(
      transform({ hiboutik, medusa }, ({ hiboutik, medusa }) => ({
        lignes: hiboutik.lignes,
        lus: hiboutik.lus,
        doublons: hiboutik.doublons,
        locationId: medusa.locationId,
        variantes: medusa.variantes,
      }))
    )
    const ecriture = appliquerNiveauxStep(
      transform({ diff, input }, ({ diff, input }) => ({
        creations: diff.creations,
        misesAJour: diff.misesAJour,
        dryRun: !!input.dryRun,
      }))
    )
    const commandes = listerCommandesNonReporteesStep(
      transform({ input }, ({ input }) => ({ jours: input.joursReconciliation ?? 7 }))
    )

    return new WorkflowResponse<Sortie>(
      transform({ diff, ecriture, commandes, medusa, input }, ({ diff, ecriture, commandes, medusa, input }) => {
        const resultat = diff as ResultatDiff & { sansLieu: boolean }
        const erreurs = [...ecriture.erreurs]
        if (resultat.sansLieu) erreurs.unshift("Aucun entrepôt (stock location) dans Medusa : rien n'a été calculé.")
        return {
          ...resultat.compteurs,
          simulation: !!input.dryRun,
          location_id: medusa.locationId,
          ecarts: resultat.ecarts,
          ecarts_total: resultat.ecarts.length,
          inconnus: resultat.inconnus,
          negatifs: resultat.negatifs,
          commandes_non_reportees: commandes.commandes,
          remontee_desactivee: commandes.remonteeDesactivee,
          erreurs,
        }
      })
    )
  }
)
