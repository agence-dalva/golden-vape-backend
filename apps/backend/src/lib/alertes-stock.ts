import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ALERTE_STOCK_MODULE } from "../modules/alerte-stock"
import type AlerteStockModuleService from "../modules/alerte-stock/service"
import { resendOptionsFromEnv } from "../modules/resend/lib/options"
import { sendEmail } from "./emails"

/**
 * Alertes de retour en stock : un client laisse son adresse sur une déclinaison épuisée, il
 * reçoit un email quand elle redevient disponible.
 *
 * Pas de déclencheur en base. Un trigger Postgres ne sait pas envoyer d'email : il faudrait
 * un processus à l'écoute à côté de Medusa, qui ignorerait tout de ses verrous, de ses
 * événements et de son module de notification. Le stock bouge ici par trois chemins — la
 * synchro Hiboutik, l'administration, et les commandes annulées qui libèrent leurs
 * réservations — et chacun passe par Medusa. Deux déclencheurs, donc, qui appellent tous
 * deux `traiterAlertesStock` :
 *
 * - un subscriber sur les niveaux de stock, pour prévenir dans la minute ;
 * - une tâche planifiée, filet de sécurité qui rattrape ce qu'aucun événement n'a signalé —
 *   une réservation libérée, un événement perdu pendant un redéploiement.
 */

type Disponibilite = {
  disponible: boolean
  produit: string
  declinaison: string | null
  handle: string | null
  image: string | null
}

type Niveau = { stocked_quantity?: number | null; reserved_quantity?: number | null } | null

/**
 * Ce qui est réellement vendable, par déclinaison : le stock moins ce que les commandes en
 * cours ont déjà réservé. Un seul emplacement sert la boutique ; on additionne tous les
 * niveaux plutôt que de le désigner.
 */
export async function disponibilites(
  container: MedusaContainer,
  variantIds: string[]
): Promise<Map<string, Disponibilite>> {
  if (variantIds.length === 0) return new Map()

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: declinaisons } = await query.graph({
    entity: "product_variant",
    filters: { id: variantIds },
    fields: [
      "id",
      "title",
      "manage_inventory",
      "allow_backorder",
      "product.title",
      "product.handle",
      "product.status",
      "product.images.url",
      "inventory_items.required_quantity",
      "inventory_items.inventory.location_levels.stocked_quantity",
      "inventory_items.inventory.location_levels.reserved_quantity",
    ],
  })

  const resultat = new Map<string, Disponibilite>()

  for (const declinaison of declinaisons) {
    const produit = declinaison.product
    let disponible: boolean

    if (!declinaison.manage_inventory || declinaison.allow_backorder) {
      disponible = true
    } else {
      // Une déclinaison peut assembler plusieurs articles de stock (un kit) : elle n'est
      // vendable que si chacun l'est.
      const articles = (declinaison.inventory_items ?? []).filter(Boolean)
      disponible =
        articles.length > 0 &&
        articles.every((article) => {
          const niveaux = (article?.inventory?.location_levels ?? []) as Niveau[]
          const libre = niveaux.reduce(
            (somme, n) => somme + Number(n?.stocked_quantity ?? 0) - Number(n?.reserved_quantity ?? 0),
            0
          )
          return libre >= Number(article?.required_quantity ?? 1)
        })
    }

    resultat.set(declinaison.id, {
      // Un produit retiré de la vente ne doit pas faire revenir le client sur une page morte.
      disponible: disponible && produit?.status === "published",
      produit: produit?.title ?? "",
      declinaison: declinaison.title ?? null,
      handle: produit?.handle ?? null,
      image: (produit?.images ?? []).find((i) => i?.url)?.url ?? null,
    })
  }

  return resultat
}

/**
 * Prévient les clients dont la déclinaison est de nouveau disponible.
 *
 * Sous verrou : le subscriber et la tâche planifiée peuvent tomber au même moment, et sans
 * lui deux passages liraient la même demande en attente et enverraient deux emails. Une
 * demande n'est marquée prévenue qu'une fois l'email confié au module de notification ; un
 * échec la laisse en attente, et le passage suivant réessaie.
 */
export async function traiterAlertesStock(
  container: MedusaContainer,
  { variantIds }: { variantIds?: string[] } = {}
): Promise<{ envoyees: number; en_attente: number }> {
  const locking = container.resolve(Modules.LOCKING)

  return locking.execute("alertes-stock", async () => {
    const alertes = container.resolve<AlerteStockModuleService>(ALERTE_STOCK_MODULE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const enAttente = await alertes.listAlerteStocks(
      { notified_at: null, ...(variantIds ? { variant_id: variantIds } : {}) },
      { take: 1000 }
    )
    if (enAttente.length === 0) return { envoyees: 0, en_attente: 0 }

    const etats = await disponibilites(container, [...new Set(enAttente.map((a) => a.variant_id))])
    const boutique = resendOptionsFromEnv().storefrontUrl
    let envoyees = 0

    for (const alerte of enAttente) {
      const etat = etats.get(alerte.variant_id)
      if (!etat?.disponible) continue

      try {
        await sendEmail(container, {
          to: alerte.email,
          template: "back-in-stock",
          trigger: "alerte-stock.disponible",
          resource: { id: alerte.id, type: "alerte_stock" },
          data: {
            product_title: etat.produit,
            variant_title: etat.declinaison,
            product_url: etat.handle ? `${boutique}/products/${etat.handle}` : boutique,
            image_url: etat.image,
          },
        })
        await alertes.updateAlerteStocks({ id: alerte.id, notified_at: new Date() })
        envoyees++
      } catch (erreur) {
        logger.error(`Alerte de stock ${alerte.id} : envoi impossible, nouvel essai au prochain passage. ${erreur}`)
      }
    }

    if (envoyees > 0) logger.info(`Alertes de stock : ${envoyees} client(s) prévenu(s).`)
    return { envoyees, en_attente: enAttente.length - envoyees }
  })
}
