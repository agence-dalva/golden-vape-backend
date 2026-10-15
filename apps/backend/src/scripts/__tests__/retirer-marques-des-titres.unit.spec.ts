import { retirerMarqueEnFin, retirerMarques } from "../retirer-marques-des-titres"

describe("retirerMarqueEnFin", () => {
  it("retire la marque après un tiret", () => {
    expect(retirerMarqueEnFin("Alabama 10 ml - Pulp", "Pulp")).toBe("Alabama 10 ml")
  })

  it("retire la marque entière sans tiret", () => {
    expect(retirerMarqueEnFin("Pyrex Zenith Minimal Innokin", "Innokin")).toBe("Pyrex Zenith Minimal")
  })

  it("retire le premier mot d'une gamme", () => {
    expect(retirerMarqueEnFin("Blue Granite 10ml Pulp", "Pulp Super Frost")).toBe("Blue Granite 10ml")
    expect(retirerMarqueEnFin("Arctic Mango 10ml / 50ml Pulp", "Pulp Super Frost")).toBe(
      "Arctic Mango 10ml / 50ml"
    )
  })

  it("ignore la casse", () => {
    expect(retirerMarqueEnFin("Cassis 10 ml - PULP", "Pulp")).toBe("Cassis 10 ml")
  })

  it("ne touche pas un titre qui ne finit pas par la marque", () => {
    expect(retirerMarqueEnFin("Starter kit Pod Flip Rechargeable", "Le Pod by pulp")).toBe(
      "Starter kit Pod Flip Rechargeable"
    )
  })

  it("n'arrache pas la marque à la fin d'un autre mot", () => {
    expect(retirerMarqueEnFin("Grapulp 10ml", "Pulp")).toBe("Grapulp 10ml")
    expect(retirerMarqueEnFin("Fraise Grapulp", "Pulp")).toBe("Fraise Grapulp")
  })

  it("ne retire pas un premier mot trop court", () => {
    expect(retirerMarqueEnFin("Cartouche Vide Le", "Le Pod by pulp")).toBe("Cartouche Vide Le")
  })

  it("ne vide jamais un titre", () => {
    expect(retirerMarqueEnFin("Smarter", "Smarter")).toBe("Smarter")
    expect(retirerMarqueEnFin("10ml - Pulp", "Pulp")).toBe("10ml - Pulp")
  })

  it("supporte les caractères spéciaux d'une marque", () => {
    expect(retirerMarqueEnFin("Concentré Fraise 30ml - Arômes & Liquide", "Arômes & Liquide")).toBe(
      "Concentré Fraise 30ml"
    )
  })

  it("ne fait rien sans marque enregistrée", () => {
    expect(retirerMarqueEnFin("Alabama 10 ml - Pulp", null)).toBe("Alabama 10 ml - Pulp")
  })

  it("s'enchaîne avec le retrait des crochets", () => {
    const sansCrochets = retirerMarques("Box Aegis [Geek Vape] - Geek Vape", new Set(["test"]))
    expect(retirerMarqueEnFin(sansCrochets, "Geek Vape")).toBe("Box Aegis")
  })
})
