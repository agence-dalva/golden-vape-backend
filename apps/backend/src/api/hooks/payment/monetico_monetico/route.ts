import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { verifySeal } from "../../../../modules/monetico/lib/seal"
import { moneticoOptionsFromEnv } from "../../../../modules/monetico/lib/options"
import {
  ACCEPTED_RETURN_CODES,
  type MoneticoConfirmation,
} from "../../../../modules/monetico/service"
import { confirmMoneticoPaymentWorkflow } from "../../../../workflows/confirm-monetico-payment"

/** Accusé de réception attendu par Monetico — documentation technique v2.0, §1.4.3.3. */
const ACK_OK = "version=2\ncdr=0\n"
const ACK_INVALID_SEAL = "version=2\ncdr=1\n"

/**
 * Interface « Retour » de Monetico.
 *
 * Le chemin `/hooks/payment/monetico_monetico` est celui déclaré auprès de Monetico ; il
 * reprend la forme du webhook natif de Medusa mais le remplace, car Monetico exige un
 * accusé de réception au format texte précis, renvoyé après vérification du sceau — là où
 * la route native répond un corps vide et diffère le traitement.
 *
 * Monetico notifie ainsi le résultat de chaque tentative de paiement. La réponse doit
 * partir en moins de 15 secondes, et son accusé de réception ne dépend que de la validité
 * du sceau — pas du résultat du paiement.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const options = moneticoOptionsFromEnv()

  // Le sceau porte sur les valeurs décodées de tous les paramètres reçus, y compris
  // ceux qu'on n'exploite pas — l'environnement de validation en ajoute d'ailleurs un
  // au nom aléatoire pour vérifier ce point. On repart donc du corps brut plutôt que
  // du parseur d'Express, dont la notation entre crochets déformerait certains noms.
  const received = parseFormUrlEncoded(req.rawBody)
  const { MAC: mac, ...sealed } = received

  if (!mac || !verifySeal(sealed, options.key, mac)) {
    logger.warn(
      `Monetico : sceau invalide pour la référence ${received.reference ?? "inconnue"}.`
    )
    res.type("text/plain").send(ACK_INVALID_SEAL)
    return
  }

  const sessionId = received["texte-libre"]
  const codeRetour = received["code-retour"]

  if (!sessionId) {
    logger.error("Monetico : notification sans identifiant de session dans « texte-libre ».")
    res.type("text/plain").send(ACK_OK)
    return
  }

  const confirmation: MoneticoConfirmation = {
    code_retour: codeRetour,
    reference: received.reference,
    montant: received.montant,
    numauto: received.numauto,
    brand: received.brand,
    cbmasquee: received.cbmasquee,
    date: received.date,
    confirmed_at: new Date().toISOString(),
  }

  // Enregistre le résultat puis, si le paiement est accepté, autorise la session et
  // finalise le panier. Une erreur ici ne doit pas produire d'accusé de réception :
  // Monetico rappellera l'interface.
  await confirmMoneticoPaymentWorkflow(req.scope).run({
    input: { sessionId, confirmation },
  })

  logger.info(
    ACCEPTED_RETURN_CODES.includes(codeRetour)
      ? `Monetico : paiement accepté pour la référence ${received.reference}.`
      : `Monetico : paiement refusé (${codeRetour}) pour la référence ${received.reference}.`
  )
  res.type("text/plain").send(ACK_OK)
}

function parseFormUrlEncoded(rawBody: unknown): Record<string, string> {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "")
  const fields: Record<string, string> = {}

  for (const [name, value] of new URLSearchParams(body)) {
    fields[name] = value
  }

  return fields
}
