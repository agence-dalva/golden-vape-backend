import type { SendcloudOptions } from "../types"

/**
 * Source unique des options Sendcloud : `medusa-config.ts` les passe au provider de
 * fulfillment, et les routes qui interrogent l'API — points relais, webhook — les relisent.
 */
export function sendcloudOptionsFromEnv(): SendcloudOptions {
  const secretKey = process.env.SENDCLOUD_SECRET_KEY ?? ""

  return {
    publicKey: process.env.SENDCLOUD_PUBLIC_KEY ?? "",
    secretKey,
    // Selon le type d'intégration, Sendcloud signe les webhooks avec une clé dédiée
    // plutôt qu'avec la clé secrète d'API. On accepte les deux.
    webhookSecret: process.env.SENDCLOUD_WEBHOOK_SECRET || secretKey,
    useOAuth: process.env.SENDCLOUD_USE_OAUTH === "true",
    senderAddressId: process.env.SENDCLOUD_SENDER_ADDRESS_ID
      ? Number(process.env.SENDCLOUD_SENDER_ADDRESS_ID)
      : undefined,
    defaultCountryCode: process.env.SENDCLOUD_COUNTRY_CODE ?? "FR",
    fallbackParcelWeightGrams: process.env.SENDCLOUD_FALLBACK_WEIGHT_GRAMS
      ? Number(process.env.SENDCLOUD_FALLBACK_WEIGHT_GRAMS)
      : undefined,
    freeShippingFromSubtotal: process.env.SHIPPING_FREE_FROM_SUBTOTAL
      ? Number(process.env.SHIPPING_FREE_FROM_SUBTOTAL)
      : undefined,
  }
}
