import { Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import { SendcloudClient } from "../modules/sendcloud/lib/client"
import { sendcloudOptionsFromEnv } from "../modules/sendcloud/lib/options"

/**
 * Diagnostic de l'intégration Sendcloud.
 *
 * Rien n'est expédié ni facturé : le script se contente de lire. Il répond dans l'ordre
 * aux questions qui bloquent la mise en route — les clés sont-elles bonnes, quels services
 * le compte propose-t-il, les contrats du marchand sont-ils branchés, et les points relais
 * répondent-ils.
 *
 *   npx medusa exec ./src/scripts/probe-sendcloud.ts
 */
export default async function probeSendcloud({ container }: ExecArgs) {
  const options = sendcloudOptionsFromEnv()

  if (!options.publicKey || !options.secretKey) {
    console.error("❌ SENDCLOUD_PUBLIC_KEY ou SENDCLOUD_SECRET_KEY manquante.")
    return
  }

  console.info(
    `Authentification : ${options.useOAuth ? "OAuth2" : "Basic"}   pays de départ : ${options.defaultCountryCode}`
  )

  const client = new SendcloudClient(options)
  const pays = options.defaultCountryCode ?? "FR"

  // 1. Contrats — dit si le marchand expédie à ses tarifs ou à ceux de Sendcloud.
  try {
    const contrats = await client.listContracts()

    if (contrats.length === 0) {
      console.info(
        "\nContrats propres : aucun.\n" +
          "   Les expéditions partiront aux tarifs négociés par Sendcloud. C'est un choix\n" +
          "   valable ; brancher les contrats Colissimo et Chronopost du marchand n'a d'intérêt\n" +
          "   que si ses tarifs sont meilleurs."
      )
    } else {
      console.info(`\nContrats propres : ${contrats.length}`)
      for (const contrat of contrats) {
        const transporteur =
          typeof contrat.carrier === "string"
            ? contrat.carrier
            : contrat.carrier?.name ?? contrat.carrier?.code ?? "?"
        console.info(
          `   #${contrat.id}  ${transporteur}${contrat.is_active === false ? "  (inactif)" : ""}`
        )
      }
    }
  } catch (e) {
    console.error(`\n❌ Lecture des contrats impossible : ${(e as Error).message}`)
    console.error("   Si c'est un 401, les clés sont mauvaises ou l'intégration exige OAuth2.")
    return
  }

  // 2. Services disponibles, séparés par type de dernier kilomètre.
  for (const lastMile of ["home_delivery", "service_point"] as const) {
    try {
      const services = await client.listShippingOptions({
        fromCountryCode: pays,
        toCountryCode: pays,
        parcels: [{ weight: { value: "1000", unit: "g" } }],
        lastMile,
        calculateQuotes: true,
      })

      const intitule = lastMile === "home_delivery" ? "à domicile" : "en point relais"
      console.info(`\nServices ${intitule} (${pays} → ${pays}, 1 kg) : ${services.length}`)

      for (const service of services.slice(0, 12)) {
        const prix = service.quotes?.[0]?.price?.total
        console.info(
          `   ${service.code.padEnd(38)} ${prix ? `${prix.value} ${prix.currency}` : "— sans devis"}`
        )
      }
      if (services.length > 12) console.info(`   … et ${services.length - 12} autres`)
    } catch (e) {
      console.error(`\n❌ Options « ${lastMile} » : ${(e as Error).message}`)
    }
  }

  // 3. Points relais — la fonctionnalité demandée par le client.
  try {
    const recherche = await client.listServicePoints({
      countryCode: pays,
      postalCode: "68870",
      carrierCodes: ["colissimo", "chronopost"],
    })
    console.info(`\nPoints relais autour de 68870 : ${recherche.results.length}`)
    for (const point of recherche.results.slice(0, 6)) {
      console.info(
        `   ${point.carrier.code.padEnd(11)} ${point.name.slice(0, 38).padEnd(38)} ` +
          `${point.address.postal_code} ${point.address.city}`
      )
    }
  } catch (e) {
    console.error(`\n❌ Points relais : ${(e as Error).message}`)
    console.error(
      "   Un 403 signifie que la case « Service Points » n'est pas cochée sur l'intégration."
    )
  }

  // 4. Le provider tel que Medusa l'expose.
  //
  // C'est le maillon dont depend le tunnel de commande : le `data` de chaque option est
  // recopie par Medusa dans l'option de livraison, et le front y lit
  // `is_service_point_required` pour decider s'il doit afficher le selecteur.
  try {
    const fulfillment = container.resolve(Modules.FULFILLMENT)
    const exposees = await fulfillment.retrieveFulfillmentOptions("sendcloud_sendcloud")

    console.info(`\nOptions exposees par le provider a Medusa : ${exposees.length}`)

    const relais = exposees.filter(
      (o) => (o as { is_service_point_required?: boolean }).is_service_point_required
    )
    console.info(`   dont ${relais.length} en point relais`)

    for (const option of exposees.slice(0, 4)) {
      console.info(`   ${JSON.stringify(option)}`)
    }
  } catch (e) {
    console.error(`\n❌ Provider non joignable depuis Medusa : ${(e as Error).message}`)
    console.error("   Verifier la declaration du module fulfillment dans medusa-config.ts.")
  }
}
