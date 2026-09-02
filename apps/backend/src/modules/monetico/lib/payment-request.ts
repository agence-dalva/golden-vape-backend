import { computeSeal } from "./seal"
import type {
  MoneticoOptions,
  MoneticoOrderContext,
  MoneticoPaymentForm,
} from "../types"

export const MONETICO_VERSION = "3.0"

export const MONETICO_PAYMENT_URL = "https://p.monetico-services.com/paiement.cgi"
export const MONETICO_PAYMENT_URL_SANDBOX =
  "https://p.monetico-services.com/test/paiement.cgi"

/**
 * Le serveur de Monetico scelle EXACTEMENT les champs postés, sans les champs vides et
 * URLs de retour comprises. C'est ce que renvoie sa page d'erreur de sceau, qui affiche
 * la chaîne qu'il a reconstituée :
 *
 *   TPE=…*contexte_commande=…*date=…*lgue=FR*montant=…*reference=…*societe=…
 *   *texte-libre=…*url_retour_err=…*url_retour_ok=…*version=3.0
 *
 * L'exemple du §9.3.1.1 de la documentation v2.0 décrit autre chose — une liste figée
 * de vingt champs, échéances vides comprises, sans les URLs de retour. Suivre la
 * documentation à la lettre fait rejeter toutes les demandes : le serveur fait foi.
 */

/** `[0-9]+(\.[0-9]{1,2})?[A-Z]{3}` — par exemple `62.73EUR`. */
export function formatAmount(amount: number, currencyCode: string): string {
  return `${amount.toFixed(2)}${currencyCode.toUpperCase()}`
}

/** `DD/MM/YYYY:HH:MM:SS`, exprimé dans le fuseau du commerçant. */
export function formatDate(date: Date, timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value

  // `hour12: false` peut rendre « 24 » au lieu de « 00 » sur certaines versions d'ICU.
  const hour = get("hour") === "24" ? "00" : get("hour")

  return `${get("day")}/${get("month")}/${get("year")}:${hour}:${get("minute")}:${get("second")}`
}

/**
 * Le document « contexte_commande » voyage en base64 d'un JSON UTF-8. Monetico
 * interdit d'envoyer une chaîne ou un objet vide pour une donnée absente : on retire
 * donc récursivement toute valeur nulle, vide, ou objet/tableau devenu vide.
 */
export function encodeOrderContext(context: MoneticoOrderContext): string {
  return Buffer.from(JSON.stringify(pruneEmpty(context)), "utf8").toString("base64")
}

function pruneEmpty(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, pruneEmpty(item)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }

  if (value === null || value === "") {
    return undefined
  }

  return value
}

export type BuildPaymentRequestInput = {
  options: MoneticoOptions
  /** Référence unique de commande — 12 caractères alphanumériques recommandés. */
  reference: string
  amount: number
  currencyCode: string
  /** Repris tel quel dans l'interface « Retour » : on y transporte l'id de session. */
  texteLibre: string
  orderContext: MoneticoOrderContext
  email?: string | null
  date?: Date
}

/**
 * Construit le formulaire scellé de la phase « Aller ».
 *
 * Documentation technique v2.0, §1.4.2 « Request interface ».
 */
export function buildPaymentRequest(
  input: BuildPaymentRequestInput
): MoneticoPaymentForm {
  const { options } = input

  // Un champ sans valeur n'est pas posté, donc pas scellé : poster les échéances vides
  // d'un paiement comptant le ferait en outre passer pour un paiement fractionné.
  const fields: Record<string, string> = {
    TPE: options.tpe,
    contexte_commande: encodeOrderContext(input.orderContext),
    date: formatDate(input.date ?? new Date(), options.timezone),
    lgue: (options.lgue ?? "FR").toUpperCase(),
    montant: formatAmount(input.amount, input.currencyCode),
    reference: input.reference,
    societe: options.societe,
    "texte-libre": input.texteLibre,
    url_retour_err: options.urlRetourErr,
    url_retour_ok: options.urlRetourOk,
    version: MONETICO_VERSION,
  }

  if (input.email) {
    fields.mail = input.email
  }

  if (options.iframe) {
    fields.mode_affichage = "iframe"
  }

  return {
    actionUrl: options.sandbox ? MONETICO_PAYMENT_URL_SANDBOX : MONETICO_PAYMENT_URL,
    // Le sceau porte sur tout ce qui part, lui excepté.
    fields: { ...fields, MAC: computeSeal(fields, options.key) },
  }
}
