import { labelsPourMedusa, sansFichiers, urlEtiquette } from "../lib/shipments"
import type { SendcloudShipment } from "../types"

/** Réponse d'annonce synchrone, telle que la doc v3 la décrit : `data` déjà déballé. */
const expedition: SendcloudShipment = {
  id: "8f3c-shipment",
  order_number: "1042",
  parcels: [
    {
      id: 383707309,
      tracking_number: "6A12345678901",
      tracking_url: "https://tracking.sendcloud.sc/forward?carrier=colissimo&code=6A12345678901",
      status: { code: "ready_to_send", message: "Ready to send" },
      documents: [
        {
          type: "label",
          document_type: "label",
          size: "a6",
          link: "https://panel.sendcloud.sc/api/v3/parcels/383707309/documents/label",
        },
      ],
      label_file: "JVBERi0xLjQK…",
    },
  ],
}

describe("labelsPourMedusa", () => {
  it("rend un label par colis, dont le lien passe par l'admin de ce backend", () => {
    const labels = labelsPourMedusa(expedition, "https://api.golden-vape.fr")

    expect(labels).toEqual([
      {
        tracking_number: "6A12345678901",
        tracking_url: "https://tracking.sendcloud.sc/forward?carrier=colissimo&code=6A12345678901",
        label_url: "https://api.golden-vape.fr/admin/delivery/labels/383707309",
      },
    ])
  })

  it("retombe sur le lien Sendcloud quand l'URL du backend n'est pas connue", () => {
    expect(urlEtiquette(expedition.parcels![0], undefined)).toBe(
      "https://panel.sendcloud.sc/api/v3/parcels/383707309/documents/label"
    )
  })

  it("ne laisse jamais un champ indéfini : Medusa attend des chaînes", () => {
    const labels = labelsPourMedusa(
      { id: "x", parcels: [{ id: 1, tracking_number: null, tracking_url: null }] },
      undefined
    )

    expect(labels).toEqual([{ tracking_number: "", tracking_url: "", label_url: "" }])
  })
})

describe("sansFichiers", () => {
  it("retire le PDF en base64 mais garde ce qu'il faut pour annuler et suivre", () => {
    const conserve = sansFichiers(expedition)

    expect(conserve.id).toBe("8f3c-shipment")
    expect(conserve.parcels![0]).not.toHaveProperty("label_file")
    expect(conserve.parcels![0].tracking_number).toBe("6A12345678901")
    expect(conserve.parcels![0].documents).toHaveLength(1)
  })
})
