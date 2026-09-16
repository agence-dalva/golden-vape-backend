import { CRON_PAR_DEFAUT, exigerIdentifiantsHiboutik, hiboutikOptionsFromEnv } from "../lib/options"

describe("hiboutikOptionsFromEnv", () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    for (const cle of Object.keys(process.env)) {
      if (cle.startsWith("HIBOUTIK_")) delete process.env[cle]
    }
  })

  afterAll(() => {
    process.env = env
  })

  it("éteint tout ce qui écrit, et vise l'entrepôt et le magasin 1", () => {
    const options = hiboutikOptionsFromEnv()
    expect(options.stockSync).toEqual({ enabled: false, cron: CRON_PAR_DEFAUT })
    expect(options.salesPush).toEqual({ enabled: false, simulation: false })
    expect(options.warehouseId).toBe(1)
    expect(options.storeId).toBe(1)
    expect(options.paymentType).toBe("CB")
    expect(options.customerId).toBeUndefined()
    expect(options.timeoutMs).toBe(20_000)
  })

  it("lit les interrupteurs et les entiers", () => {
    process.env.HIBOUTIK_STOCK_SYNC_ENABLED = "true"
    process.env.HIBOUTIK_STOCK_SYNC_CRON = "*/5 * * * *"
    process.env.HIBOUTIK_SALES_PUSH_ENABLED = "1"
    process.env.HIBOUTIK_SALES_PUSH_SIMULATION = "false"
    process.env.HIBOUTIK_CUSTOMER_ID = "42"
    process.env.HIBOUTIK_PAYMENT_TYPE = "WEB"
    const options = hiboutikOptionsFromEnv()
    expect(options.stockSync).toEqual({ enabled: true, cron: "*/5 * * * *" })
    expect(options.salesPush).toEqual({ enabled: true, simulation: false })
    expect(options.customerId).toBe(42)
    expect(options.paymentType).toBe("WEB")
  })

  it("ignore un entier illisible plutôt que d'en inventer un", () => {
    process.env.HIBOUTIK_WAREHOUSE_ID = "deux"
    process.env.HIBOUTIK_CUSTOMER_ID = "abc"
    const options = hiboutikOptionsFromEnv()
    expect(options.warehouseId).toBe(1)
    expect(options.customerId).toBeUndefined()
  })

  it("refuse de travailler sans identifiants", () => {
    expect(() => exigerIdentifiantsHiboutik(hiboutikOptionsFromEnv())).toThrow(/HIBOUTIK_ACCOUNT/)
    process.env.HIBOUTIK_ACCOUNT = "goldenvape"
    process.env.HIBOUTIK_USER = "u"
    process.env.HIBOUTIK_API_KEY = "k"
    expect(() => exigerIdentifiantsHiboutik(hiboutikOptionsFromEnv())).not.toThrow()
  })
})
