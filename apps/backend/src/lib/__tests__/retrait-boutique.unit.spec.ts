import { lieuRetrait, statutRetrait, type LieuRetrait } from "../retrait-boutique"

const boutique: LieuRetrait = {
  nom: "Golden Vape",
  address_1: "18 Av. de la République",
  address_2: null,
  postal_code: "70200",
  city: "Lure",
  phone: null,
}

describe("statutRetrait", () => {
  it("est à préparer tant qu'aucune exécution n'existe", () => {
    expect(statutRetrait([])).toBe("a_preparer")
    expect(statutRetrait(null)).toBe("a_preparer")
  })

  it("ignore une préparation annulée", () => {
    expect(statutRetrait([{ canceled_at: "2026-10-09", delivered_at: null }])).toBe("a_preparer")
  })

  it("est prête dès qu'une exécution active n'est pas remise", () => {
    expect(statutRetrait([{ canceled_at: null, delivered_at: null }])).toBe("pret")
    expect(
      statutRetrait([
        { canceled_at: null, delivered_at: "2026-10-09" },
        { canceled_at: null, delivered_at: null },
      ])
    ).toBe("pret")
  })

  it("est retirée quand toutes les exécutions actives sont remises", () => {
    expect(
      statutRetrait([
        { canceled_at: "2026-10-08", delivered_at: null },
        { canceled_at: null, delivered_at: "2026-10-09" },
      ])
    ).toBe("retire")
  })
})

describe("lieuRetrait", () => {
  const options = new Map([["so_retrait", boutique]])

  it("rend la boutique quand la commande passe par une option de retrait", () => {
    expect(lieuRetrait([{ shipping_option_id: "so_retrait" }], options)).toBe(boutique)
  })

  it("rend null pour une livraison, ou sans méthode", () => {
    expect(lieuRetrait([{ shipping_option_id: "so_domicile" }], options)).toBeNull()
    expect(lieuRetrait([{ shipping_option_id: null }, null], options)).toBeNull()
    expect(lieuRetrait(undefined, options)).toBeNull()
  })
})
