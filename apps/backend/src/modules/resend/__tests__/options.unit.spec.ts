import { storefrontUrlFromEnv } from "../lib/options"

describe("storefrontUrlFromEnv", () => {
  const env = process.env

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.STOREFRONT_URL
    delete process.env.STORE_CORS
  })

  afterAll(() => {
    process.env = env
  })

  it("préfère STOREFRONT_URL, sans barre finale", () => {
    process.env.STOREFRONT_URL = "https://golden-vape.fr/"
    process.env.STORE_CORS = "https://autre.fr"
    expect(storefrontUrlFromEnv()).toBe("https://golden-vape.fr")
  })

  it("retombe sur la première origine https de STORE_CORS", () => {
    process.env.STORE_CORS = "http://localhost:8000,https://staging.golden-vape.fr"
    expect(storefrontUrlFromEnv()).toBe("https://staging.golden-vape.fr")
  })

  it("prend la première origine s'il n'y a pas de https, et localhost:3000 sans rien", () => {
    process.env.STORE_CORS = "http://localhost:8000,http://localhost:3000"
    expect(storefrontUrlFromEnv()).toBe("http://localhost:8000")
    delete process.env.STORE_CORS
    expect(storefrontUrlFromEnv()).toBe("http://localhost:3000")
  })
})
