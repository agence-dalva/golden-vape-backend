import type { LigneHiboutik } from "../lib/stock-diff"
import { extRefAnnulation, extRefCommande, preparerLignesVente, prixUnitaireTtc } from "../lib/ventes"

const carte = new Map<string, LigneHiboutik>([
  ["SKU-A", { sku: "SKU-A", product_id: 12, size_id: 3, stock: 5 }],
  ["SKU-B", { sku: "SKU-B", product_id: 40, size_id: 0, stock: 1 }],
])

describe("références externes", () => {
  it("distinguent la commande de son annulation", () => {
    expect(extRefCommande("order_1")).toBe("order_1")
    expect(extRefAnnulation("order_1")).toBe("order_1-annulation")
  })
})

describe("prixUnitaireTtc", () => {
  it("divise le total payé par la quantité, à deux décimales", () => {
    expect(prixUnitaireTtc({ total: 39.8, quantity: 2 })).toBe("19.90")
    expect(prixUnitaireTtc({ total: "5.9", quantity: "1" })).toBe("5.90")
  })

  it("supporte une quantité négative ou absente", () => {
    expect(prixUnitaireTtc({ total: 10, quantity: -2 })).toBe("5.00")
    expect(prixUnitaireTtc({ total: 10, quantity: 0 })).toBe("10.00")
  })
})

describe("preparerLignesVente", () => {
  const articles = [
    { title: "Alabama 10 ml", variant_title: "6mg", variant_sku: "SKU-A", quantity: 2, total: 11.8 },
    { title: "Kit", variant_title: null, variant_sku: "SKU-B", quantity: 1, total: 54.9 },
    { title: "Sans code", variant_title: "0mg", variant_sku: null, quantity: 1, total: 5.9 },
    { title: "Inconnu", variant_title: "3mg", variant_sku: "SKU-Z", quantity: 3, total: 17.7 },
    { title: "Rien", variant_title: null, variant_sku: "SKU-A", quantity: 0, total: 0 },
  ]

  it("traduit les SKU connus et écarte les autres en disant pourquoi", () => {
    const { lignes, ignorees } = preparerLignesVente(articles, carte, 1)
    expect(lignes).toEqual([
      { product_id: 12, size_id: 3, quantity: 2, product_price: "5.90", product_comments: "6mg" },
      { product_id: 40, size_id: 0, quantity: 1, product_price: "54.90", product_comments: undefined },
    ])
    expect(ignorees).toEqual([
      { sku: null, titre: "Sans code / 0mg", quantite: 1, motif: "sans_sku" },
      { sku: "SKU-Z", titre: "Inconnu / 3mg", quantite: 3, motif: "inconnu_hiboutik" },
    ])
  })

  it("renverse les quantités pour une annulation, au même prix", () => {
    const { lignes } = preparerLignesVente(articles.slice(0, 1), carte, -1)
    expect(lignes[0]).toMatchObject({ quantity: -2, product_price: "5.90" })
  })
})
