import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import {
  batchLinksWorkflow,
  createShippingOptionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"

const PROVIDER_ID = "sendcloud_sendcloud"

/**
 * Options proposées au client, nommées par ce qu'il cherche et non par le transporteur.
 *
 * « Colissimo » ou « Chronopost » ne lui disent rien ; « en point relais », « à domicile »,
 * « express » si. Le transporteur est un détail d'exécution — c'est précisément ce que
 * l'agrégateur permet d'abstraire. Modifier cette liste et rejouer le script suffit à
 * ajuster l'offre : les options déjà créées sont laissées telles quelles.
 */
const OFFRE = [
  {
    nom: "Point relais",
    code: "chronopost:shop2shop",
    description: "Retrait en commerce de proximité, sous 3 à 5 jours",
  },
  {
    nom: "Point relais La Poste",
    code: "colissimo:post-office",
    description: "Retrait en bureau de poste ou consigne Pickup",
  },
  {
    nom: "À domicile",
    code: "colissimo:home/fr",
    description: "Livraison à votre adresse sous 2 à 3 jours ouvrés",
  },
  {
    nom: "À domicile contre signature",
    code: "colissimo:home/signature,fr",
    description: "Remise en main propre, contre signature",
  },
  {
    nom: "Express avant 18 h",
    code: "chronopost:18",
    description: "Livraison le lendemain avant 18 h",
  },
]

/**
 * Met en place les options de livraison Sendcloud.
 *
 * Rejouable : le rattachement du fournisseur comme la création des options sont ignorés
 * s'ils existent déjà. C'est ce qui permet de s'en servir aussi bien pour amorcer un
 * environnement neuf que pour ajouter une offre à un environnement en service.
 *
 *   npx medusa exec ./src/scripts/setup-sendcloud-shipping.ts
 */
export default async function setupSendcloudShipping({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  // 1. Emplacement, zone de service et profil : les trois rattachements d'une option.
  const { data: emplacements } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "fulfillment_providers.id", "sales_channels.id"],
  })
  const emplacement = emplacements[0]

  if (!emplacement) {
    console.error("❌ Aucun emplacement de stock. En créer un dans l'administration d'abord.")
    return
  }

  const zones = await fulfillment.listServiceZones({}, { take: 5 })
  const zone = zones[0]

  if (!zone) {
    console.error("❌ Aucune zone de service. En créer une sur l'ensemble d'expédition.")
    return
  }

  const profils = await fulfillment.listShippingProfiles({}, { take: 5 })
  const profil = profils.find((p) => p.type === "default") ?? profils[0]

  if (!profil) {
    console.error("❌ Aucun profil de livraison.")
    return
  }

  console.info(
    `Emplacement : ${emplacement.name}\nZone        : ${zone.name}\nProfil      : ${profil.name}`
  )

  // 2. Rattacher le fournisseur à l'emplacement. Sans ce lien, l'administration affiche
  //    « aucun fournisseur de livraison » et les options ne sont pas utilisables.
  const dejaRattache = (emplacement.fulfillment_providers ?? []).some(
    (p) => (p as { id?: string } | null)?.id === PROVIDER_ID
  )

  if (dejaRattache) {
    console.info(`\nFournisseur ${PROVIDER_ID} : déjà rattaché.`)
  } else {
    await batchLinksWorkflow(container).run({
      input: {
        create: [
          {
            [Modules.STOCK_LOCATION]: { stock_location_id: emplacement.id },
            [Modules.FULFILLMENT]: { fulfillment_provider_id: PROVIDER_ID },
          },
        ],
      },
    })
    console.info(`\n✅ Fournisseur ${PROVIDER_ID} rattaché à « ${emplacement.name} ».`)
  }

  // 3. Rattacher l'emplacement aux canaux de vente.
  //
  //    Medusa ne propose une option de livraison que si son ensemble d'expedition est
  //    joignable depuis le canal de vente du panier. Sans ce lien, le tunnel affiche une
  //    liste de transporteurs vide, sans erreur ni explication — le symptome est muet.
  const salesChannel = container.resolve(Modules.SALES_CHANNEL)
  const canaux = await salesChannel.listSalesChannels({}, { take: 20 })
  const dejaRattaches = new Set(
    (emplacement.sales_channels ?? []).map((c) => (c as { id?: string } | null)?.id)
  )
  const aRattacher = canaux.filter((c) => !dejaRattaches.has(c.id))

  if (aRattacher.length === 0) {
    console.info(`Canaux de vente     : deja rattaches.`)
  } else {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: emplacement.id, add: aRattacher.map((c) => c.id) },
    })
    console.info(
      `✅ Canaux de vente rattaches : ${aRattacher.map((c) => c.name).join(", ")}`
    )
  }

  // 4. Les services tels que le provider les expose. Leur objet complet est recopié dans
  //    le `data` de l'option : c'est lui que le tunnel de commande relit pour savoir s'il
  //    doit demander un point relais.
  const services = await fulfillment.retrieveFulfillmentOptions(PROVIDER_ID)
  const parCode = new Map(
    services.map((s) => [(s as { id: string }).id, s as Record<string, unknown>])
  )

  const existantes = await fulfillment.listShippingOptions({ service_zone: { id: zone.id } })
  const parNom = new Map(existantes.map((o) => [o.name, o]))

  console.info("")

  for (const entree of OFFRE) {
    const service = parCode.get(entree.code)

    if (!service) {
      console.error(`   ❌ « ${entree.nom} » : le service ${entree.code} n'est pas proposé.`)
      continue
    }

    // Une option deja creee voit son `data` rafraichi plutot qu'ignore : c'est lui que le
    // tunnel de commande relit, et il doit suivre ce que le provider expose aujourd'hui.
    const existante = parNom.get(entree.nom)

    if (existante) {
      const identique = JSON.stringify(existante.data) === JSON.stringify(service)

      if (identique) {
        console.info(`   « ${entree.nom} » a jour.`)
      } else {
        await fulfillment.updateShippingOptions(existante.id, { data: service })
        console.info(`   ↻ « ${entree.nom} » : données rafraîchies.`)
      }
      continue
    }

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: entree.nom,
          service_zone_id: zone.id,
          shipping_profile_id: profil.id,
          provider_id: PROVIDER_ID,
          // « calculated » fait appeler notre provider a chaque panier : le prix vient de
          // la grille du contrat, selon le poids et la destination. En « flat », il serait
          // fige et la tarification au poids perdue.
          price_type: "calculated",
          type: {
            label: entree.nom,
            description: entree.description,
            code: entree.code,
          },
          data: service,
        },
      ],
    })

    const relais = service.is_service_point_required ? "  (point relais)" : ""
    console.info(`   ✅ « ${entree.nom} » → ${entree.code}${relais}`)
  }

  console.info(
    "\nLes prix ne sont pas fixés ici : ils sont demandés à Sendcloud au moment du panier.\n" +
      "Un panier sans poids fait echouer ce calcul — Sendcloud refuse un colis de 0 g."
  )
}
