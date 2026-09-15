import type { ResendOptions } from "../types"

/** Source unique des options d'envoi : `medusa-config.ts` les passe au provider. */
export function resendOptionsFromEnv(): ResendOptions {
  return {
    apiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.EMAIL_FROM || "Golden Vape <onboarding@resend.dev>",
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    storefrontUrl: storefrontUrlFromEnv(),
  }
}

/**
 * Adresse publique de la boutique, base des liens dans les emails.
 *
 * `STOREFRONT_URL` quand elle est définie. Sinon `STORE_CORS`, qui liste les origines
 * autorisées à appeler l'API : sur un environnement déployé elle n'en contient qu'une,
 * celle du front — on prend la première en https, pour ne pas retomber sur le port
 * 8000 du défaut Medusa en local.
 */
export function storefrontUrlFromEnv(): string {
  const explicite = process.env.STOREFRONT_URL?.trim()

  if (explicite) {
    return explicite.replace(/\/+$/, "")
  }

  const origines = (process.env.STORE_CORS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)

  const publique = origines.find((o) => o.startsWith("https://")) ?? origines[0]

  return (publique || "http://localhost:3000").replace(/\/+$/, "")
}
