import { paiementAccepte } from "../service"

describe("paiementAccepte", () => {
  it("accepte un paiement réel dans les deux modes", () => {
    expect(paiementAccepte("paiement", false)).toBe(true)
    expect(paiementAccepte("paiement", true)).toBe(true)
  })

  it("n'accepte un paiement de test qu'en mode test", () => {
    expect(paiementAccepte("payetest", true)).toBe(true)
    expect(paiementAccepte("payetest", false)).toBe(false)
  })

  it("refuse les autres codes", () => {
    expect(paiementAccepte("Annulation", true)).toBe(false)
    expect(paiementAccepte(undefined, true)).toBe(false)
    expect(paiementAccepte("", false)).toBe(false)
  })
})
