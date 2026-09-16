import type { IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addProductToSale,
  closeSale,
  createSale,
  deleteSale,
  deleteSaleLineItem,
  fetchSale,
  searchSalesByExtRef,
  setSaleAttribute,
  setSaleComments,
} from "../client"
import { hiboutikOptionsFromEnv } from "./options"
import { obtenirCarteSku } from "./stock-cache"
import type { LigneHiboutik } from "./stock-diff"

/*
  Une commande web devient une vente en caisse.

  C'est ce que veut le marchand : ses synthèses doivent voir une vente, avec son montant et son
  mode de paiement, pas un déstockage qui passerait pour de la perte. Hiboutik n'a d'ailleurs
  pas d'autre façon propre de retirer une unité du stock. La séquence est celle d'un ticket :
  ouvrir la vente, la marquer de la référence de la commande, y mettre les articles, la
  commenter, indiquer le règlement, la clôturer — c'est la clôture qui déstocke.

  Pourquoi pas un workflow Medusa. Un workflow paie par la compensation de ses étapes ; ici la
  seule chose réversible est une vente *ouverte*, et seulement jusqu'à la clôture, qui est le
  dernier appel. La compensation se réduit à un nettoyage de bonne volonté qu'un `try/catch`
  exprime directement. L'idempotence, elle, vient d'Hiboutik — la référence externe, posée en
  tout premier, retrouve une vente déjà créée — et du marqueur écrit sur la commande.

  Rien ici ne relance : le bus d'événements est local et ne rejoue pas. Ce qui échoue est
  marqué sur la commande et remonte dans le rapport de la synchronisation de stock, où un
  bouton permet de le reporter à la main.
*/

export type LigneIgnoree = {
  sku: string | null
  titre: string
  quantite: number
  motif: "sans_sku" | "inconnu_hiboutik"
}

export type MarqueurHiboutik = {
  status: "poussee" | "echec" | "sans_lignes" | "a_verifier" | "simulee"
  ext_ref: string
  pushed_at: string
  sale_id?: number
  erreur?: string
  lignes_ignorees?: LigneIgnoree[]
  annulation?: Omit<MarqueurHiboutik, "annulation">
}

export type LigneVente = {
  product_id: number
  size_id: number
  quantity: number
  product_price: string
  product_comments?: string
}

type ArticleCommande = {
  title?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  quantity: unknown
  total: unknown
}

type CommandeLue = {
  id: string
  display_id: number | string
  status: string
  currency_code: string
  metadata: Record<string, unknown> | null
  items: ArticleCommande[]
}

/** La référence externe de la vente : l'identifiant de commande, unique et jamais réutilisé. */
export function extRefCommande(orderId: string): string {
  return orderId
}

export function extRefAnnulation(orderId: string): string {
  return `${orderId}-annulation`
}

/**
 * Le prix unitaire tel qu'Hiboutik l'attend : TTC, remises comprises. Le catalogue stocke du
 * hors-taxe, mais `total` est ce que le client a payé pour la ligne ; le ticket de caisse doit
 * dire la même chose. Un centime peut se perdre sur une quantité impaire — le stock, lui, est
 * exact, et c'est lui qui compte.
 */
export function prixUnitaireTtc(article: { total: unknown; quantity: unknown }): string {
  const quantite = Math.abs(Number(article.quantity)) || 1
  return (Number(article.total) / quantite).toFixed(2)
}

/** Les lignes de la vente, et celles qu'on ne peut pas y mettre — faute de SKU, ou d'un SKU inconnu de la caisse. */
export function preparerLignesVente(
  articles: ArticleCommande[],
  carte: Map<string, LigneHiboutik>,
  signe: 1 | -1
): { lignes: LigneVente[]; ignorees: LigneIgnoree[] } {
  const lignes: LigneVente[] = []
  const ignorees: LigneIgnoree[] = []
  for (const article of articles) {
    const quantite = Math.abs(Number(article.quantity)) || 0
    if (quantite === 0) continue
    const titre = [article.title, article.variant_title].filter(Boolean).join(" / ") || "article"
    const sku = article.variant_sku?.trim() || null
    if (!sku) {
      ignorees.push({ sku, titre, quantite, motif: "sans_sku" })
      continue
    }
    const cible = carte.get(sku)
    if (!cible) {
      ignorees.push({ sku, titre, quantite, motif: "inconnu_hiboutik" })
      continue
    }
    lignes.push({
      product_id: cible.product_id,
      size_id: cible.size_id,
      quantity: signe * quantite,
      product_price: prixUnitaireTtc(article),
      product_comments: article.variant_title ?? undefined,
    })
  }
  return { lignes, ignorees }
}

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur)
}

async function lireCommande(container: MedusaContainer, orderId: string): Promise<CommandeLue | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [commande],
  } = await query.graph({
    entity: "order",
    filters: { id: orderId },
    fields: [
      "id",
      "display_id",
      "status",
      "currency_code",
      "metadata",
      "total",
      "item_total",
      // Lignes entières, taxes et remises comprises : Medusa ne calcule la quantité et le
      // total d'une ligne qu'à partir d'elles — champ par champ, ils n'existent pas.
      "items.*",
      "items.tax_lines.*",
      "items.adjustments.*",
    ],
  })
  return (commande as unknown as CommandeLue | undefined) ?? null
}

/**
 * Le marqueur va dans les métadonnées de la commande, par le service du module : le workflow
 * de mise à jour exige un utilisateur, émet un événement et refuse une commande annulée. Les
 * métadonnées se remplacent en bloc, on repart donc toujours de celles en place.
 */
async function ecrireMarqueur(
  container: MedusaContainer,
  commande: CommandeLue,
  marqueur: MarqueurHiboutik | ((existant: MarqueurHiboutik | undefined) => MarqueurHiboutik)
): Promise<MarqueurHiboutik> {
  const commandes = container.resolve<IOrderModuleService>(Modules.ORDER)
  const existant = commande.metadata?.hiboutik as MarqueurHiboutik | undefined
  const nouveau = typeof marqueur === "function" ? marqueur(existant) : marqueur
  await commandes.updateOrders(commande.id, { metadata: { ...(commande.metadata ?? {}), hiboutik: nouveau } })
  commande.metadata = { ...(commande.metadata ?? {}), hiboutik: nouveau }
  return nouveau
}

/**
 * Une vente ouverte traîne dans les tickets en cours de la caisse et n'a jamais déstocké : on
 * la supprime — d'abord ses lignes, puis elle. Si même cela échoue, on la commente pour que le
 * marchand sache quoi en faire.
 */
async function nettoyerVenteOuverte(saleId: number, displayId: number | string): Promise<boolean> {
  try {
    await deleteSale(saleId)
    return true
  } catch {
    // Non vide : on retire les lignes puis on réessaie.
  }
  try {
    const vente = await fetchSale(saleId)
    for (const ligne of vente?.line_items ?? []) {
      await deleteSaleLineItem(Number(ligne.line_item_id))
    }
    await deleteSale(saleId)
    return true
  } catch {
    // Dernier recours : dire au marchand ce qu'est ce ticket.
  }
  try {
    await setSaleComments(saleId, `ÉCHEC report web — commande n° ${displayId} — ticket à supprimer en caisse`)
  } catch {
    // Plus rien à tenter ; le marqueur « a_verifier » portera l'identifiant.
  }
  return false
}

type Contexte = {
  extRef: string
  commentaire: string
  signe: 1 | -1
  poser: (marqueur: MarqueurHiboutik | ((existant: MarqueurHiboutik | undefined) => MarqueurHiboutik)) => Promise<MarqueurHiboutik>
}

/** La séquence commune à la vente et à son annulation. */
async function creerVente(container: MedusaContainer, commande: CommandeLue, contexte: Contexte): Promise<MarqueurHiboutik> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = hiboutikOptionsFromEnv()
  const maintenant = () => new Date().toISOString()
  const base = { ext_ref: contexte.extRef }

  // Une vente porte-t-elle déjà cette référence ? Clôturée : le travail est fait, seul le
  // marqueur manquait. Ouverte : un passage précédent s'est arrêté en route, on nettoie.
  const existantes = await searchSalesByExtRef(contexte.extRef)
  const cloturee = existantes.find((v) => Number(v.completed) === 1 || v.completed === true)
  if (cloturee) {
    return contexte.poser({ ...base, status: "poussee", sale_id: Number(cloturee.sale_id), pushed_at: maintenant() })
  }
  for (const ouverte of existantes) {
    if (!(await nettoyerVenteOuverte(Number(ouverte.sale_id), commande.display_id))) {
      return contexte.poser({
        ...base,
        status: "a_verifier",
        sale_id: Number(ouverte.sale_id),
        pushed_at: maintenant(),
        erreur: "vente ouverte impossible à supprimer",
      })
    }
  }

  const skus = commande.items.map((a) => a.variant_sku?.trim()).filter((s): s is string => !!s)
  const carte = await obtenirCarteSku(skus)
  const { lignes, ignorees } = preparerLignesVente(commande.items, carte, contexte.signe)

  if (lignes.length === 0) {
    logger.warn(`Commande #${commande.display_id} : aucune ligne à reporter en caisse (${ignorees.length} ignorée(s)).`)
    return contexte.poser({ ...base, status: "sans_lignes", pushed_at: maintenant(), lignes_ignorees: ignorees })
  }

  const commentaire =
    contexte.commentaire +
    (ignorees.length
      ? ` — non reporté : ${ignorees.map((i) => `${i.quantite}× ${i.titre}`).join(", ")}`
      : "")

  const payload = {
    store_id: options.storeId,
    currency_code: (commande.currency_code || "eur").toUpperCase(),
    customer_id: options.customerId,
    vendor_id: options.vendorId,
    payment: options.paymentType,
    ext_ref: contexte.extRef,
    commentaire,
    lignes,
  }

  if (options.salesPush.simulation) {
    logger.info(`Vente Hiboutik simulée pour la commande #${commande.display_id} : ${JSON.stringify(payload)}`)
    return contexte.poser({ ...base, status: "simulee", pushed_at: maintenant(), lignes_ignorees: ignorees })
  }

  let saleId: number | undefined
  try {
    saleId = (
      await createSale({
        store_id: payload.store_id,
        currency_code: payload.currency_code,
        customer_id: payload.customer_id,
        vendor_id: payload.vendor_id,
      })
    ).sale_id
    // La référence d'abord : dès cet instant, un plantage est rattrapable par la recherche.
    await setSaleAttribute(saleId, "ext_ref", contexte.extRef)
    for (const ligne of lignes) {
      await addProductToSale({ sale_id: saleId, ...ligne })
    }
    await setSaleComments(saleId, commentaire)
    await setSaleAttribute(saleId, "payment", options.paymentType)
    await closeSale(saleId)

    logger.info(
      `Commande #${commande.display_id} reportée dans Hiboutik (vente ${saleId}, ${lignes.length} ligne(s), ${ignorees.length} ignorée(s)).`
    )
    return contexte.poser({ ...base, status: "poussee", sale_id: saleId, pushed_at: maintenant(), lignes_ignorees: ignorees })
  } catch (erreur) {
    const nettoyee = saleId ? await nettoyerVenteOuverte(saleId, commande.display_id) : true
    logger.error(`Vente Hiboutik non créée pour la commande #${commande.display_id} : ${message(erreur)}`)
    return contexte.poser({
      ...base,
      status: nettoyee ? "echec" : "a_verifier",
      sale_id: saleId,
      pushed_at: maintenant(),
      erreur: message(erreur),
      lignes_ignorees: ignorees,
    })
  }
}

export async function pousserVenteCommande(
  container: MedusaContainer,
  orderId: string,
  opts: { force?: boolean } = {}
): Promise<MarqueurHiboutik | null> {
  const options = hiboutikOptionsFromEnv()
  if (!options.salesPush.enabled) return null

  const commande = await lireCommande(container, orderId)
  if (!commande) {
    container.resolve(ContainerRegistrationKeys.LOGGER).warn(`Vente Hiboutik : commande ${orderId} introuvable.`)
    return null
  }
  const existant = commande.metadata?.hiboutik as MarqueurHiboutik | undefined
  if (existant?.status === "poussee" && !opts.force) return existant

  return creerVente(container, commande, {
    extRef: extRefCommande(commande.id),
    commentaire: `Commande web n° ${commande.display_id}`,
    signe: 1,
    poser: (marqueur) => ecrireMarqueur(container, commande, marqueur),
  })
}

/** L'annulation d'une commande reportée : une vente aux quantités négatives, qui remet le stock. */
export async function pousserVenteAnnulation(container: MedusaContainer, orderId: string): Promise<MarqueurHiboutik | null> {
  const options = hiboutikOptionsFromEnv()
  if (!options.salesPush.enabled) return null

  const commande = await lireCommande(container, orderId)
  if (!commande) return null
  const existant = commande.metadata?.hiboutik as MarqueurHiboutik | undefined
  if (existant?.status !== "poussee") {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .info(`Commande #${commande.display_id} annulée : rien à reprendre en caisse, elle n'y avait pas été reportée.`)
    return existant ?? null
  }
  if (existant.annulation?.status === "poussee") return existant

  return creerVente(container, commande, {
    extRef: extRefAnnulation(commande.id),
    commentaire: `Annulation commande web n° ${commande.display_id} (vente Hiboutik ${existant.sale_id ?? "?"})`,
    signe: -1,
    poser: (marqueur) =>
      ecrireMarqueur(container, commande, (courant) => {
        const annulation = typeof marqueur === "function" ? marqueur(courant?.annulation) : marqueur
        return { ...(courant ?? existant), annulation }
      }),
  })
}
