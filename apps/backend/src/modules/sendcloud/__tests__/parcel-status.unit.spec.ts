import { parcelTransition } from "../lib/parcel-status"

describe("parcelTransition", () => {
  it("fait partir la commande au premier scan du transporteur", () => {
    expect(parcelTransition({ id: 22, message: "Shipment picked up by driver" })).toBe("shipped")
    expect(parcelTransition({ id: 3 })).toBe("shipped")
    expect(parcelTransition({ id: 91 })).toBe("shipped")
  })

  it("garde « expédiée » pendant le tri, les tentatives et l'attente en point relais", () => {
    expect(parcelTransition({ id: 7 })).toBe("shipped")
    expect(parcelTransition({ id: 8 })).toBe("shipped")
    expect(parcelTransition({ id: 12 })).toBe("shipped")
  })

  it("livre à la remise au destinataire, chez lui ou au point relais", () => {
    expect(parcelTransition({ id: 11, message: "Delivered" })).toBe("delivered")
    expect(parcelTransition({ id: 93 })).toBe("delivered")
  })

  it("signale une annulation, demandée ou effective", () => {
    expect(parcelTransition({ id: 2000 })).toBe("canceled")
    expect(parcelTransition({ id: 1999 })).toBe("canceled")
  })

  it("ne bouge pas avant le départ ni sur un statut inconnu", () => {
    expect(parcelTransition({ id: 1, message: "Announced" })).toBeNull()
    expect(parcelTransition({ id: 1000, message: "Ready to send" })).toBeNull()
    expect(parcelTransition({ id: 1337 })).toBeNull()
    expect(parcelTransition({ id: 62997, message: "Address invalid" })).toBeNull()
  })

  it("se rabat sur le message quand l'identifiant manque", () => {
    expect(parcelTransition({ message: "delivered" })).toBe("delivered")
    expect(parcelTransition({ message: "Parcel en route" })).toBe("shipped")
    expect(parcelTransition({})).toBeNull()
  })
})
