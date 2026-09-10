import { createHmac, timingSafeEqual } from "crypto"

/**
 * Vérifie la signature d'un webhook Sendcloud.
 *
 * Sendcloud signe le corps **brut** en HMAC-SHA256 avec la clé secrète de l'intégration,
 * et place le résultat hexadécimal dans l'en-tête `Sendcloud-Signature`. Le sceau porte
 * sur les octets reçus : recalculer la signature sur un objet re-sérialisé échouerait au
 * moindre écart d'espacement ou d'ordre des clés.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
  receivedSignature: string | undefined
): boolean {
  if (!secret || !receivedSignature) {
    return false
  }

  const corps = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8")
  const attendu = createHmac("sha256", secret).update(corps).digest("hex")

  const a = Buffer.from(attendu, "utf8")
  const b = Buffer.from(receivedSignature.trim().toLowerCase(), "utf8")

  return a.length === b.length && timingSafeEqual(a, b)
}
