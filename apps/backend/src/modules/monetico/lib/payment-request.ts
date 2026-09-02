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
 * Champs entrant dans le calcul du sceau de la phase « Aller ».
 *
 * Ils sont figés : la documentation technique v2.0 (§9.3.1.1) montre une chaîne qui
 * contient toujours les champs de paiement fractionné et le champ `options`, même
 * vides, et qui n'inclut en revanche ni les URLs de retour ni `mode_affichage`. On
 * scelle donc exactement cet ensemble, et on poste en plus les champs non scellés.
 */
export const SEALED_REQUEST_FIELDS = [
  "TPE",
  "contexte_commande",
  "date",
  "dateech1",
  "dateech2",
  "dateech3",
  "dateech4",
  "lgue",
  "mail",
  "montant",
  "montantech1",
  "montantech2",
  "montantech3",
  "montantech4",
  "nbrech",
  "options",
  "reference",
  "societe",
  "texte-libre",
  "version",
] as const

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

  const sealed: Record<string, string> = Object.fromEntries(
    SEALED_REQUEST_FIELDS.map((field) => [field, ""])
  )

  sealed.TPE = options.tpe
  sealed.version = MONETICO_VERSION
  sealed.societe = options.societe
  sealed.lgue = (options.lgue ?? "FR").toUpperCase()
  sealed.date = formatDate(input.date ?? new Date(), options.timezone)
  sealed.montant = formatAmount(input.amount, input.currencyCode)
  sealed.reference = input.reference
  sealed["texte-libre"] = input.texteLibre
  sealed.contexte_commande = encodeOrderContext(input.orderContext)
  sealed.mail = input.email ?? ""

  const mac = computeSeal(sealed, options.key)

  // On ne poste que les champs scellés qui portent une valeur : `options` n'est pas un
  // champ de formulaire reconnu, et poster les échéances vides d'un paiement comptant
  // ferait passer la demande pour un paiement fractionné.
  const fields: Record<string, string> = {}
  for (const [name, value] of Object.entries(sealed)) {
    if (value !== "" && name !== "options") {
      fields[name] = value
    }
  }

  fields.url_retour_ok = options.urlRetourOk
  fields.url_retour_err = options.urlRetourErr
  if (options.iframe) {
    fields.mode_affichage = "iframe"
  }
  fields.MAC = mac

  return {
    actionUrl: options.sandbox ? MONETICO_PAYMENT_URL_SANDBOX : MONETICO_PAYMENT_URL,
    fields,
  }
}
