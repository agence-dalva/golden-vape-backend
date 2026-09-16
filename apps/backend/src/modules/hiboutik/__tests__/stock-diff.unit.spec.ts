import type { HiboutikStockLine } from "../client"
import { calculerEcarts, indexerStockHiboutik, type VarianteLue } from "../lib/stock-diff"

const LIEU = "sloc_1"

function ligne(barcode: string | null, stock: number, product_id = 7, product_size = 1): HiboutikStockLine {
  return { product_id, product_size, warehouse_id: 1, stock_available: stock, product_barcode: barcode }
}

function variante(
  sku: string | null,
  articles: { id: string; stocked?: number; reserved?: number; sansNiveau?: boolean }[],
  manage_inventory = true
): VarianteLue {
  return {
    id: `var_${sku ?? "x"}`,
    sku,
    titre: `Produit ${sku ?? "?"}`,
    manage_inventory,
    inventory_items: articles.map((a) => ({
      inventory_item_id: a.id,
      location_levels: a.sansNiveau
        ? []
        : [{ id: `lvl_${a.id}`, location_id: LIEU, stocked_quantity: a.stocked ?? 0, reserved_quantity: a.reserved ?? 0 }],
    })),
  }
}

describe("indexerStockHiboutik", () => {
  it("indexe par code-barres, ignore les vides et compte les doublons", () => {
    const { parSku, doublons } = indexerStockHiboutik([ligne("A", 3), ligne(null, 9), ligne("", 9), ligne("A", 5), ligne("B", -2)])
    expect(parSku.size).toBe(2)
    expect(parSku.get("A")?.stock).toBe(5)
    expect(parSku.get("B")?.stock).toBe(-2)
    expect(doublons).toBe(1)
  })
})

describe("calculerEcarts", () => {
  const stock = indexerStockHiboutik([ligne("A", 5), ligne("B", 0), ligne("N", -3)]).parSku

  it("crée le niveau manquant au stock de la caisse", () => {
    const r = calculerEcarts(stock, [variante("A", [{ id: "ii_a", sansNiveau: true }])], LIEU)
    expect(r.creations).toEqual([{ inventory_item_id: "ii_a", location_id: LIEU, stocked_quantity: 5 }])
    expect(r.ecarts[0]).toMatchObject({ action: "creer", avant: null, apres: 5, hiboutik: 5, reserve: 0 })
    expect(r.compteurs).toMatchObject({ apparies: 1, crees: 1, mis_a_jour: 0, inchanges: 0 })
  })

  it("ajoute le réservé au stock caisse — l'invariant", () => {
    const r = calculerEcarts(stock, [variante("A", [{ id: "ii_a", stocked: 5, reserved: 2 }])], LIEU)
    expect(r.misesAJour).toEqual([{ inventory_item_id: "ii_a", location_id: LIEU, stocked_quantity: 7 }])
    expect(r.ecarts[0]).toMatchObject({ action: "mettre_a_jour", avant: 5, apres: 7, reserve: 2 })
  })

  it("ne réécrit pas un niveau déjà juste", () => {
    const r = calculerEcarts(stock, [variante("A", [{ id: "ii_a", stocked: 7, reserved: 2 }])], LIEU)
    expect(r.misesAJour).toEqual([])
    expect(r.creations).toEqual([])
    expect(r.compteurs.inchanges).toBe(1)
  })

  it("borne un stock caisse négatif à zéro et le signale", () => {
    const r = calculerEcarts(stock, [variante("N", [{ id: "ii_n", stocked: 4, reserved: 1 }])], LIEU)
    expect(r.misesAJour[0].stocked_quantity).toBe(1)
    expect(r.negatifs).toEqual(["N"])
    expect(r.compteurs.negatifs_hiboutik).toBe(1)
  })

  it("compte ce qu'il ne peut pas traiter sans rien écrire", () => {
    const r = calculerEcarts(
      stock,
      [
        variante(null, [{ id: "ii_1", stocked: 1 }]),
        variante("A", [{ id: "ii_2", stocked: 1 }], false),
        variante("Z", [{ id: "ii_3", stocked: 1 }]),
        variante("B", []),
      ],
      LIEU
    )
    expect(r.creations).toEqual([])
    expect(r.misesAJour).toEqual([])
    expect(r.compteurs).toMatchObject({ sans_sku: 1, non_geres: 1, inconnus_hiboutik: 1, sans_article: 1, apparies: 1 })
    expect(r.inconnus).toEqual(["Z"])
  })

  it("laisse intact un article visé par deux SKU aux cibles différentes", () => {
    const r = calculerEcarts(
      stock,
      [variante("A", [{ id: "ii_partage", stocked: 1 }]), variante("B", [{ id: "ii_partage", stocked: 1 }])],
      LIEU
    )
    expect(r.misesAJour).toEqual([])
    expect(r.ecarts).toEqual([])
    expect(r.compteurs.conflits).toBe(1)
  })

  it("suit chaque article d'inventaire d'une variante", () => {
    const r = calculerEcarts(stock, [variante("A", [{ id: "ii_1", stocked: 5 }, { id: "ii_2", sansNiveau: true }])], LIEU)
    expect(r.compteurs).toMatchObject({ inchanges: 1, crees: 1 })
  })

  it("ignore un niveau posé sur un autre entrepôt", () => {
    const v = variante("A", [{ id: "ii_a", stocked: 99 }])
    v.inventory_items[0].location_levels[0].location_id = "sloc_autre"
    const r = calculerEcarts(stock, [v], LIEU)
    expect(r.creations).toEqual([{ inventory_item_id: "ii_a", location_id: LIEU, stocked_quantity: 5 }])
  })
})
