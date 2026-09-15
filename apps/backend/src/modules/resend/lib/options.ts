import type { ResendOptions } from "../types"

/** Source unique des options d'envoi : `medusa-config.ts` les passe au provider. */
export function resendOptionsFromEnv(): ResendOptions {
  return {
    apiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.EMAIL_FROM || "Golden Vape <onboarding@resend.dev>",
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    storefrontUrl: (process.env.STOREFRONT_URL || "http://localhost:3000").replace(/\/+$/, ""),
  }
}
