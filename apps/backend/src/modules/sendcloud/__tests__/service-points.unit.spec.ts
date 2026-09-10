import { regrouperParLieu } from "../lib/service-points"
import type { SendcloudServicePoint } from "../types"

function point(
  partiel: Partial<SendcloudServicePoint> & { carrierCode: string }
): SendcloudServicePoint {
  return {
    id: partiel.id ?? 1,
    name: partiel.name ?? "COMMERCE",
    carrier: { code: partiel.carrierCode, name: partiel.carrierCode },
    carrier_service_point_id: partiel.carrier_service_point_id ?? "X",
    address: partiel.address ?? {
      street: "RUE DE LA GARE",
      house_number: "4",
      postal_code: "68870",
      city: "BARTENHEIM",
      country_code: "FR",
    },
    position: partiel.position,
    general_shop_type: partiel.general_shop_type,
  }
}

describe("regrouperParLieu", () => {
  it("réunit sous une seule entrée un commerce servant les deux réseaux", () => {
    const groupes = regrouperParLieu([
      point({
        id: 10,
        carrierCode: "colissimo",
        carrier_service_point_id: "680210",
        name: "EQUIP MOTO",
        position: { latitude: 47.634251, longitude: 7.478191 },
      }),
      // Meme lieu, autre reseau : le nom differe de casse, la position non.
      point({
        id: 77,
        carrierCode: "chronopost",
        carrier_service_point_id: "CH-99",
        name: "Equip Moto",
        position: { latitude: 47.634251, longitude: 7.478191 },
      }),
    ])

    expect(groupes).toHaveLength(1)
    expect(groupes[0].carriers.map((c) => c.code)).toEqual(["colissimo", "chronopost"])
    // Chaque reseau garde son identifiant : c'est lui qui part a l'affranchissement.
    expect(groupes[0].carriers.map((c) => c.service_point_id)).toEqual(["680210", "CH-99"])
  })

  it("garde distincts deux lieux différents", () => {
    const groupes = regrouperParLieu([
      point({ carrierCode: "colissimo", position: { latitude: 47.6342, longitude: 7.4781 } }),
      point({ carrierCode: "colissimo", position: { latitude: 47.7, longitude: 7.5 } }),
    ])

    expect(groupes).toHaveLength(2)
  })

  it("tolère des coordonnées absentes en retombant sur code postal et nom", () => {
    const groupes = regrouperParLieu([
      point({ carrierCode: "colissimo", name: "VIVAL", position: undefined }),
      point({ carrierCode: "chronopost", name: "vival", position: undefined }),
    ])

    expect(groupes).toHaveLength(1)
    expect(groupes[0].carriers).toHaveLength(2)
  })

  it("ne confond pas deux commerces distincts du même code postal", () => {
    const groupes = regrouperParLieu([
      point({ carrierCode: "colissimo", name: "VIVAL", position: undefined }),
      point({ carrierCode: "colissimo", name: "EQUIP MOTO", position: undefined }),
    ])

    expect(groupes).toHaveLength(2)
  })

  it("rend un tableau vide sans points", () => {
    expect(regrouperParLieu([])).toEqual([])
  })
})
