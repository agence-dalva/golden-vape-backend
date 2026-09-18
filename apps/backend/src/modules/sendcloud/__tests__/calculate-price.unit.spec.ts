import SendcloudFulfillmentProviderService from "../service"
import type { SendcloudOptions, SendcloudShippingOption } from "../types"

const options: SendcloudOptions = {
  publicKey: "pk",
  secretKey: "sk",
  webhookSecret: "sk",
  useOAuth: false,
  defaultCountryCode: "FR",
}

const optionData = { shipping_option_code: "colissimo:home/fr" }

/** Service dont le client Sendcloud est remplacé par un espion : aucun appel réseau. */
function serviceAvecClient(listShippingOptions: jest.Mock) {
  const service = new SendcloudFulfillmentProviderService(
    { logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as never },
    options
  )
  Object.assign(service, { client_: { listShippingOptions } })
  return service
}

function offre(prix: string): SendcloudShippingOption[] {
  return [
    {
      code: "colissimo:home/fr",
      name: "Colissimo Domicile",
      quotes: [{ price: { total: { value: prix, currency: "EUR" } } }],
    } as unknown as SendcloudShippingOption,
  ]
}

describe("calculatePrice", () => {
  it("rend 0 sans interroger Sendcloud quand le panier est vide", async () => {
    const listShippingOptions = jest.fn()
    const service = serviceAvecClient(listShippingOptions)

    const prix = await service.calculatePrice(optionData, {}, { items: [] } as never)

    expect(prix).toEqual({ calculated_amount: 0, is_calculated_price_tax_inclusive: false })
    expect(listShippingOptions).not.toHaveBeenCalled()
  })

  it("rend 0 de même quand le contexte ne porte aucun article", async () => {
    const listShippingOptions = jest.fn()
    const service = serviceAvecClient(listShippingOptions)

    const prix = await service.calculatePrice(optionData, {}, {} as never)

    expect(prix.calculated_amount).toBe(0)
    expect(listShippingOptions).not.toHaveBeenCalled()
  })

  it("interroge Sendcloud avec le poids du panier dès qu'il contient un article", async () => {
    const listShippingOptions = jest.fn().mockResolvedValue(offre("7.80"))
    const service = serviceAvecClient(listShippingOptions)

    const prix = await service.calculatePrice(optionData, {}, {
      items: [{ quantity: 2, variant: { weight: 40 } }],
      shipping_address: { country_code: "fr", postal_code: "70200" },
    } as never)

    expect(prix).toEqual({ calculated_amount: 7.8, is_calculated_price_tax_inclusive: false })
    expect(listShippingOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        toCountryCode: "FR",
        toPostalCode: "70200",
        parcels: [{ weight: { value: "80", unit: "g" } }],
      })
    )
  })
})
