import type { HiboutikStockLine } from "../client"

/*
  Le cœur de la synchronisation, sans aucun effet de bord : d'un côté le stock de la caisse,
  de l'autre les variantes Medusa et leurs niveaux, au milieu la liste exacte de ce qu'il
  faut écrire. Tout ce qui décide est ici, et se teste sans base ni réseau.

  L'invariant. Medusa affiche `disponible = stocked − reserved` ; Hiboutik ne connaît que le
  stock physique restant. Quand un client commande sur le site, Medusa réserve (`reserved`
  monte, `stocked` ne bouge pas) et la vente remontée en caisse fait baisser Hiboutik d'autant.
  En posant `stocked = hiboutik + reserved`, le disponible du site vaut toujours le stock de la
  caisse : avant l'expédition, (H − q) + q = H ; à l'expédition Medusa retire q des deux
  colonnes, (H − q) + 0 — la valeur déjà en base. Une vente en boutique fait baisser H, donc le
  disponible, sans toucher aux commandes web en cours.
*/

export type LigneHiboutik = {
  sku: string
  product_id: number
  size_id: number
  stock: number
}

export type NiveauLu = {
  id: string
  location_id: string
  stocked_quantity: number
  reserved_quantity: number
}

export type ArticleLu = {
  inventory_item_id: string
  location_levels: NiveauLu[]
}

export type VarianteLue = {
  id: string
  sku: string | null
  titre: string
  manage_inventory: boolean
  inventory_items: ArticleLu[]
}

export type Ecart = {
  sku: string
  titre: string
  inventory_item_id: string
  action: "creer" | "mettre_a_jour" | "inchange"
  hiboutik: number
  reserve: number
  avant: number | null
  apres: number
}

export type NiveauAEcrire = {
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
}

export type Compteurs = {
  /** Lignes de stock lues chez Hiboutik. */
  lus: number
  /** Variantes Medusa dont le SKU existe chez Hiboutik. */
  apparies: number
  sans_sku: number
  non_geres: number
  sans_article: number
  inconnus_hiboutik: number
  negatifs_hiboutik: number
  doublons_hiboutik: number
  conflits: number
  crees: number
  mis_a_jour: number
  inchanges: number
}

export type ResultatDiff = {
  creations: NiveauAEcrire[]
  misesAJour: NiveauAEcrire[]
  ecarts: Ecart[]
  compteurs: Compteurs
  /** SKU Medusa qu'Hiboutik ne connaît pas — à rapprocher à la main. */
  inconnus: string[]
  /** SKU dont le stock caisse est négatif — une erreur de comptage à corriger en caisse. */
  negatifs: string[]
}

/** Indexe la liste de stock par code-barres. Les lignes sans code-barres ne peuvent rien apparier. */
export function indexerStockHiboutik(lignes: HiboutikStockLine[]): {
  parSku: Map<string, LigneHiboutik>
  doublons: number
} {
  const parSku = new Map<string, LigneHiboutik>()
  let doublons = 0
  for (const ligne of lignes) {
    const sku = String(ligne.product_barcode ?? "").trim()
    if (!sku) continue
    if (parSku.has(sku)) doublons++
    parSku.set(sku, {
      sku,
      product_id: Number(ligne.product_id),
      size_id: Number(ligne.product_size),
      stock: Number(ligne.stock_available) || 0,
    })
  }
  return { parSku, doublons }
}

type Cible = {
  sku: string
  titre: string
  hiboutik: number
  reserve: number
  apres: number
  niveau: NiveauLu | null
  conflit: boolean
}

/**
 * Ce qu'il faut écrire pour que chaque niveau Medusa respecte l'invariant.
 *
 * Un stock caisse négatif est ramené à zéro : c'est un comptage à corriger chez Hiboutik, pas
 * une réalité à recopier — et le module d'inventaire l'accepterait sans broncher, là où
 * l'administration le refuse. Quand deux SKU visent le même article d'inventaire avec des
 * cibles différentes, on ne tranche pas : l'article est laissé tel quel et compté en conflit.
 */
export function calculerEcarts(
  parSku: Map<string, LigneHiboutik>,
  variantes: VarianteLue[],
  locationId: string,
  lus = parSku.size,
  doublons = 0
): ResultatDiff {
  const compteurs: Compteurs = {
    lus,
    apparies: 0,
    sans_sku: 0,
    non_geres: 0,
    sans_article: 0,
    inconnus_hiboutik: 0,
    negatifs_hiboutik: 0,
    doublons_hiboutik: doublons,
    conflits: 0,
    crees: 0,
    mis_a_jour: 0,
    inchanges: 0,
  }
  const inconnus: string[] = []
  const negatifs: string[] = []
  const cibles = new Map<string, Cible>()

  for (const variante of variantes) {
    const sku = variante.sku?.trim()
    if (!sku) {
      compteurs.sans_sku++
      continue
    }
    if (!variante.manage_inventory) {
      compteurs.non_geres++
      continue
    }
    const ligne = parSku.get(sku)
    if (!ligne) {
      compteurs.inconnus_hiboutik++
      inconnus.push(sku)
      continue
    }
    compteurs.apparies++
    if (variante.inventory_items.length === 0) {
      compteurs.sans_article++
      continue
    }

    let hiboutik = ligne.stock
    if (hiboutik < 0) {
      compteurs.negatifs_hiboutik++
      negatifs.push(sku)
      hiboutik = 0
    }

    // Un kit peut porter plusieurs articles d'inventaire : chacun suit le stock de la caisse.
    for (const article of variante.inventory_items) {
      const niveau = article.location_levels.find((n) => n.location_id === locationId) ?? null
      const reserve = niveau ? Number(niveau.reserved_quantity) || 0 : 0
      const apres = hiboutik + reserve

      const existante = cibles.get(article.inventory_item_id)
      if (existante) {
        if (existante.apres !== apres && !existante.conflit) {
          existante.conflit = true
          compteurs.conflits++
        }
        continue
      }
      cibles.set(article.inventory_item_id, {
        sku,
        titre: variante.titre,
        hiboutik,
        reserve,
        apres,
        niveau,
        conflit: false,
      })
    }
  }

  const creations: NiveauAEcrire[] = []
  const misesAJour: NiveauAEcrire[] = []
  const ecarts: Ecart[] = []

  for (const [inventoryItemId, cible] of cibles) {
    if (cible.conflit) continue

    const base = {
      sku: cible.sku,
      titre: cible.titre,
      inventory_item_id: inventoryItemId,
      hiboutik: cible.hiboutik,
      reserve: cible.reserve,
      apres: cible.apres,
    }
    if (!cible.niveau) {
      creations.push({ inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: cible.apres })
      compteurs.crees++
      ecarts.push({ ...base, action: "creer", avant: null })
    } else if (Number(cible.niveau.stocked_quantity) !== cible.apres) {
      misesAJour.push({ inventory_item_id: inventoryItemId, location_id: locationId, stocked_quantity: cible.apres })
      compteurs.mis_a_jour++
      ecarts.push({ ...base, action: "mettre_a_jour", avant: Number(cible.niveau.stocked_quantity) })
    } else {
      compteurs.inchanges++
      ecarts.push({ ...base, action: "inchange", avant: Number(cible.niveau.stocked_quantity) })
    }
  }

  return { creations, misesAJour, ecarts, compteurs, inconnus, negatifs }
}
