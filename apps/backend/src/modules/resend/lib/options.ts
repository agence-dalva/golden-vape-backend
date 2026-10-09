import type { ResendOptions } from "../types"

/** Source unique des options d'envoi : `medusa-config.ts` les passe au provider. */
export function resendOptionsFromEnv(): ResendOptions {
  return {
    apiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.EMAIL_FROM || "Golden Vape <onboarding@resend.dev>",
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    storefrontUrl: storefrontUrlFromEnv(),
    // Les deux ou rien : un jeton sans boîte ne saurait pas où déposer. Et seulement sur un
    // poste de développement — voir `mailtrapAutorise`.
    mailtrap:
      mailtrapDemande() && mailtrapAutorise()
        ? { token: process.env.MAILTRAP_API_TOKEN!, inboxId: process.env.MAILTRAP_INBOX_ID! }
        : undefined,
  }
}

export function mailtrapDemande(): boolean {
  return Boolean(process.env.MAILTRAP_API_TOKEN && process.env.MAILTRAP_INBOX_ID)
}

/**
 * La boîte de test n'est permise qu'en développement, sur un poste.
 *
 * `NODE_ENV` ne suffit pas : Medusa ne le met à « production » que pour `medusa start`, et à
 * « development » pour toutes les autres commandes — y compris un `medusa exec` lancé depuis
 * le shell du conteneur Railway, qui tourne contre la vraie base. Railway pose
 * `RAILWAY_ENVIRONMENT_NAME` sur ses machines : sa présence suffit à refuser, staging comme
 * production.
 */
export function mailtrapAutorise(): boolean {
  const developpement = (process.env.NODE_ENV ?? "development") === "development"
  const surRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT)
  return developpement && !surRailway
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
