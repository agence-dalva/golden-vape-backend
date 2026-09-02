import { buildPaymentRequest } from "../modules/monetico/lib/payment-request"
import { moneticoOptionsFromEnv } from "../modules/monetico/lib/options"

/**
 * Diagnostic de la phase « Aller » de Monetico.
 *
 * Poste une demande de paiement réelle, scellée avec les identifiants de l'environnement
 * courant, et rapporte à quelle étape le serveur de Monetico s'arrête. Aucun paiement n'est
 * engagé : le script s'arrête à l'affichage de la page de saisie de carte.
 *
 * Les trois refus possibles se distinguent nettement, ce qui désigne la variable fautive :
 *   — « commerçant non identifié » → MONETICO_TPE ou MONETICO_SOCIETE
 *   — « la valeur du MAC est erronée » → MONETICO_KEY, ou composition du sceau
 *   — page de saisie de carte → tout est bon
 *
 * En cas de sceau refusé, Monetico affiche la chaîne qu'il a reconstituée : la comparer à
 * celle produite ici désigne le champ en trop ou manquant.
 *
 *   npx medusa exec ./src/scripts/probe-monetico.ts
 */
export default async function probeMonetico() {
  const options = moneticoOptionsFromEnv()
  const form = buildPaymentRequest({
    options,
    reference: "DIAG" + Date.now().toString().slice(-8),
    amount: 1,
    currencyCode: "eur",
    texteLibre: "diagnostic",
    orderContext: {
      billing: { addressLine1: "1 rue de Test", city: "Paris", postalCode: "75001", country: "FR" },
    },
    email: "test@example.com",
  })

  console.info(`TPE=${options.tpe}  societe=${options.societe}  ${form.actionUrl}`)
  console.info(`champs postés : ${Object.keys(form.fields).sort().join(", ")}`)
  console.info(
    `contexte_commande : ${Buffer.from(form.fields.contexte_commande, "base64").toString("utf8")}`
  )

  const res = await fetch(form.actionUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form.fields).toString(),
    redirect: "manual",
  })

  const html = await res.text()
  const texte = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&eacute;/gi, "é")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&agrave;/gi, "à")
    .replace(/&#x2F;/gi, "/")
    .replace(/\s+/g, " ")
    .trim()

  if (/n'a pas été identifié|has not been identified/i.test(html)) {
    console.error("❌ commerçant non identifié — vérifier MONETICO_TPE et MONETICO_SOCIETE")
  } else if (/valeur du MAC est erronée|signature des informations/i.test(html)) {
    console.error("❌ sceau refusé — vérifier MONETICO_KEY et la composition de la chaîne")
    console.error(`   chaîne attendue par Monetico : ${texte.slice(texte.indexOf("TPE="), 600)}`)
  } else if (/erronées ou incompl|Format invalide pour/i.test(html)) {
    console.error("❌ contexte_commande refusé — un champ du document JSON est mal formé")
    const champ = texte.match(/Format invalide pour le\(s\) champ\(s\)\s*:\s*(\S+)/i)?.[1]
    if (champ) console.error(`   champ en cause : ${champ}`)
  } else if (!/Numéro de carte|Payer par carte/i.test(html)) {
    console.error("❌ refus non reconnu")
  } else {
    console.info("✅ page de paiement obtenue")
  }

  console.info(`HTTP ${res.status} — ${texte.slice(0, 300)}`)
}
