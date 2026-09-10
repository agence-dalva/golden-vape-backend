import { createHmac } from "crypto"
import { verifyWebhookSignature } from "../lib/signature"

/**
 * Vecteur publié par Sendcloud dans sa documentation des webhooks : la chaîne
 * `{"key": "value"}` signée avec le secret `secretkey`. Il fige la convention —
 * HMAC-SHA256, sortie hexadécimale — et détecterait une dérive de leur côté comme du nôtre.
 */
const CORPS_OFFICIEL = '{"key": "value"}'
const SECRET_OFFICIEL = "secretkey"
const SIGNATURE_OFFICIELLE =
  "1eed4b3d41f4653ac64fd56f1bf1cbfd349e4482cbc11dff7134bd93e5da4b0a"

describe("verifyWebhookSignature", () => {
  it("accepte le vecteur de la documentation Sendcloud", () => {
    expect(
      verifyWebhookSignature(CORPS_OFFICIEL, SECRET_OFFICIEL, SIGNATURE_OFFICIELLE)
    ).toBe(true)
  })

  it("accepte une signature en majuscules", () => {
    expect(
      verifyWebhookSignature(
        CORPS_OFFICIEL,
        SECRET_OFFICIEL,
        SIGNATURE_OFFICIELLE.toUpperCase()
      )
    ).toBe(true)
  })

  it("accepte un corps passé en Buffer, comme le fournit Express", () => {
    expect(
      verifyWebhookSignature(
        Buffer.from(CORPS_OFFICIEL, "utf8"),
        SECRET_OFFICIEL,
        SIGNATURE_OFFICIELLE
      )
    ).toBe(true)
  })

  it("refuse un corps modifié d'un seul caractère", () => {
    expect(
      verifyWebhookSignature('{"key": "valu3"}', SECRET_OFFICIEL, SIGNATURE_OFFICIELLE)
    ).toBe(false)
  })

  it("refuse un autre secret", () => {
    expect(
      verifyWebhookSignature(CORPS_OFFICIEL, "mauvais-secret", SIGNATURE_OFFICIELLE)
    ).toBe(false)
  })

  it("refuse une signature absente ou un secret vide", () => {
    expect(verifyWebhookSignature(CORPS_OFFICIEL, SECRET_OFFICIEL, undefined)).toBe(false)
    expect(verifyWebhookSignature(CORPS_OFFICIEL, "", SIGNATURE_OFFICIELLE)).toBe(false)
  })

  it("refuse une signature de longueur differente sans lever d'exception", () => {
    // timingSafeEqual jette si les tampons different de taille : la garde de longueur
    // doit intervenir avant, sinon un message malforme ferait tomber la route en 500
    // au lieu d'un refus propre — et Sendcloud le rejouerait dix fois.
    expect(verifyWebhookSignature(CORPS_OFFICIEL, SECRET_OFFICIEL, "abc")).toBe(false)
  })

  it("valide un corps realiste de changement de statut", () => {
    const corps = JSON.stringify({
      action: "parcel_status_changed",
      timestamp: 1757500000000,
      parcel: {
        id: 123456,
        tracking_number: "6A123456789FR",
        status: { id: 11, message: "Delivered" },
      },
    })
    const signature = createHmac("sha256", SECRET_OFFICIEL).update(corps).digest("hex")

    expect(verifyWebhookSignature(corps, SECRET_OFFICIEL, signature)).toBe(true)
  })
})
