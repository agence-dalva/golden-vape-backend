import type { MoneticoOptions } from "../types"

/**
 * Source unique des options Monetico : `medusa-config.ts` les passe au provider, et
 * la route qui construit le formulaire les relit pour sceller la demande de paiement.
 */
export function moneticoOptionsFromEnv(): MoneticoOptions {
  return {
    tpe: process.env.MONETICO_TPE ?? "",
    societe: process.env.MONETICO_SOCIETE ?? "",
    key: process.env.MONETICO_KEY ?? "",
    sandbox: process.env.MONETICO_SANDBOX !== "false",
    urlRetourOk: process.env.MONETICO_URL_RETOUR_OK ?? "",
    urlRetourErr: process.env.MONETICO_URL_RETOUR_ERR ?? "",
    lgue: process.env.MONETICO_LGUE ?? "FR",
    iframe: process.env.MONETICO_IFRAME === "true",
    timezone: process.env.MONETICO_TIMEZONE ?? "Europe/Paris",
    deferredCapture: process.env.MONETICO_DEFERRED_CAPTURE === "true",
  }
}
