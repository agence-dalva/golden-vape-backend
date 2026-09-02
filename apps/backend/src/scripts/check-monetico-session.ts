import { Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import type { MoneticoSessionData } from "../modules/monetico/service"

/**
 * État des sessions de paiement Monetico.
 *
 * Répond à la question « la notification serveur à serveur est-elle arrivée ? ». Tant que
 * Monetico n'a pas notifié, la session n'a pas de bloc `monetico` dans ses données et la
 * finalisation du panier échoue sur « Session … was not authorized with the provider ».
 *
 *   npx medusa exec ./src/scripts/check-monetico-session.js
 *   npx medusa exec ./src/scripts/check-monetico-session.js payses_01ABC…
 */
export default async function checkMoneticoSession({ container, args }: ExecArgs) {
  const paymentModule = container.resolve(Modules.PAYMENT)

  const sessions = args?.[0]
    ? [await paymentModule.retrievePaymentSession(args[0])]
    : await paymentModule.listPaymentSessions(
        { provider_id: "pp_monetico_monetico" },
        { order: { created_at: "DESC" }, take: 10 }
      )

  if (sessions.length === 0) {
    console.info("Aucune session de paiement Monetico.")
    return
  }

  for (const session of sessions) {
    const data = session.data as MoneticoSessionData | undefined
    const confirmation = data?.monetico

    console.info(
      `\n${session.id}\n` +
        `   créée le  : ${session.created_at}\n` +
        `   montant   : ${session.amount} ${session.currency_code}\n` +
        `   statut    : ${session.status}\n` +
        `   référence : ${data?.reference ?? "—"}\n` +
        (confirmation
          ? `   ✅ notification reçue le ${confirmation.confirmed_at}\n` +
            `      code retour : ${confirmation.code_retour}   autorisation : ${confirmation.numauto ?? "—"}\n` +
            `      montant     : ${confirmation.montant}   carte : ${confirmation.cbmasquee ?? "—"}`
          : `   ❌ AUCUNE notification de Monetico reçue pour cette session.\n` +
            `      La finalisation du panier échouera tant qu'elle n'arrive pas.`)
    )
  }

  console.info(
    "\nSi aucune session n'a de notification, c'est l'URL de notification (CGI2)\n" +
      "déclarée chez Monetico qui ne pointe pas sur ce serveur.\n"
  )
}
