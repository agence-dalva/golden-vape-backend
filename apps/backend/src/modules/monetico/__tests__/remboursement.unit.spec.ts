import MoneticoProviderService from "../service"

const logger = { warn: jest.fn() } as any

const service = new MoneticoProviderService({ logger }, {
  tpe: "1234567",
  societe: "golden",
  key: "0".repeat(40),
  urlRetourOk: "https://exemple.fr/ok",
  urlRetourErr: "https://exemple.fr/err",
})

describe("refundPayment", () => {
  beforeEach(() => logger.warn.mockClear())

  it("inscrit le remboursement sans lever, pour que l'annulation aille au bout", async () => {
    const sortie = await service.refundPayment({
      amount: 12.5,
      data: { reference: "ABC123", monetico: { code_retour: "paiement" } },
    } as any)

    expect(sortie.data).toMatchObject({
      reference: "ABC123",
      monetico: { code_retour: "paiement" },
      remboursements_manuels: [{ montant: "12.5" }],
    })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain("ABC123")
  })

  it("lit le montant brut que transmet le module de paiement", async () => {
    const sortie = await service.refundPayment({
      amount: { value: "29.9", precision: 20 },
      data: { reference: "ABC123" },
    } as any)

    expect(sortie.data?.remboursements_manuels).toMatchObject([{ montant: "29.9" }])
    expect(logger.warn.mock.calls[0][0]).toContain("29.9 €")
  })

  it("garde les remboursements précédents", async () => {
    const sortie = await service.refundPayment({
      amount: 5,
      data: { remboursements_manuels: [{ montant: "3", inscrit_le: "2026-10-21T08:00:00.000Z" }] },
    } as any)

    expect(sortie.data?.remboursements_manuels).toHaveLength(2)
  })
})
