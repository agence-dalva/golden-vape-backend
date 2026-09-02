import { createHmac, timingSafeEqual } from "crypto"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * La clé de sécurité Monetico est communiquée sous la forme d'une chaîne de 40
 * caractères hexadécimaux. Sa « forme opérationnelle » — celle qui sert de clé
 * HMAC — est la chaîne de 20 octets correspondante.
 *
 * Documentation technique v2.0, §1.3 « Merchant security key ».
 */
export function toOperationalKey(hexKey: string): Buffer {
  const normalized = hexKey.trim()
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      "La clé de sécurité Monetico doit être une chaîne de 40 caractères hexadécimaux."
    )
  }
  return Buffer.from(normalized, "hex")
}

/**
 * Chaîne à certifier : une suite `nom_champ=valeur_champ`, séparée par `*`, triée
 * par ordre alphabétique ASCII (chiffres, puis MAJUSCULES, puis minuscules — ce qui
 * est exactement l'ordre du tri par défaut de JavaScript sur ces noms de champs).
 *
 * Documentation technique v2.0, §9.3 « Calculation of MAC seal ».
 */
export function buildSealString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .sort()
    .map((name) => `${name}=${fields[name] ?? ""}`)
    .join("*")
}

/** Sceau HMAC-SHA1, rendu en 40 caractères hexadécimaux minuscules. */
export function computeSeal(fields: Record<string, string>, hexKey: string): string {
  return createHmac("sha1", toOperationalKey(hexKey))
    .update(buildSealString(fields), "utf8")
    .digest("hex")
}

/**
 * Monetico renvoie le sceau en majuscules sur l'interface « Retour » et l'attend en
 * minuscules sur l'interface « Aller » : la comparaison est donc insensible à la casse.
 */
export function verifySeal(
  fields: Record<string, string>,
  hexKey: string,
  receivedMac: string
): boolean {
  const expected = Buffer.from(computeSeal(fields, hexKey), "utf8")
  const received = Buffer.from((receivedMac ?? "").trim().toLowerCase(), "utf8")

  return expected.length === received.length && timingSafeEqual(expected, received)
}
