import { ecartNotification, referenceAttendue } from "../lib/notification"

const session = {
  id: "payses_01K7ABCDEF0123456789XYZ",
  amount: 25.9,
  currency_code: "eur",
  data: { reference: "0123456789XY" },
}

describe("ecartNotification", () => {
  it("accepte une notification conforme à la session", () => {
    expect(ecartNotification({ montant: "25.90EUR", reference: "0123456789XY" }, session)).toBeNull()
  })

  it("refuse un autre montant", () => {
    expect(ecartNotification({ montant: "1.00EUR", reference: "0123456789XY" }, session)).toMatch(
      /montant 1.00EUR au lieu de 25.90EUR/
    )
  })

  it("refuse un montant absent", () => {
    expect(ecartNotification({ reference: "0123456789XY" }, session)).toMatch(/montant absent/)
  })

  it("refuse une autre référence", () => {
    expect(ecartNotification({ montant: "25.90EUR", reference: "AUTRE" }, session)).toMatch(
      /référence AUTRE/
    )
  })

  it("accepte un montant stocké en texte", () => {
    expect(
      ecartNotification({ montant: "25.90EUR", reference: "0123456789XY" }, { ...session, amount: "25.9" })
    ).toBeNull()
  })
})

describe("referenceAttendue", () => {
  it("reprend la référence déposée sur la session", () => {
    expect(referenceAttendue(session)).toBe("0123456789XY")
  })

  it("retombe sur la fin de l'identifiant, comme le formulaire", () => {
    expect(referenceAttendue({ ...session, data: {} })).toBe("0123456789XYZ".slice(-12))
  })
})
