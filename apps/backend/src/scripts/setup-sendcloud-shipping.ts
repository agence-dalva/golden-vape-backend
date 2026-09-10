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
const OFFRE: {
  nom: string
  code: string
  description: string
  /** Faux pour retirer l'option de la boutique sans la supprimer. */
  actif?: boolean
}[] = [
  {
    nom: "Point relais",
    code: "chronopost:shop2shop",
    description: "Retrait en commerce de proximité, sous 3 à 5 jours",
  },
  {
    // Le reseau Colissimo n'est pas que postal : mesure sur le Haut-Rhin, il compte
    // 81 % de commerces et consignes pour 19 % de bureaux de poste. Le nommer
    // « bureau de poste » decrivait la minorite.
    nom: "Point relais ou bureau de poste",
    code: "colissimo:post-office",
    description: "Commerçants, consignes Pickup et bureaux de poste",
  },
  {
    nom: "À domicile",
    code: "colissimo:home/fr",
    description: "Livraison à votre adresse sous 2 à 3 jours ouvrés",
  },
  {
    nom: "À domicile, en boîte aux lettres",
    code: "chronopost:18mailbox",
    description: "Déposé dans votre boîte aux lettres le lendemain",
  },
  {
    // Conservees mais retirees de la boutique : l'offre se limite pour l'instant au
    // standard et aux points relais. Repasser `actif` a vrai et rejouer le script suffit.
    nom: "À domicile contre signature",
    code: "colissimo:home/signature,fr",
    description: "Remise en main propre, contre signature",
    actif: false,
  },
  {
    nom: "Express avant 18 h",
    code: "chronopost:18",
    description: "Livraison le lendemain avant 18 h",
    actif: false,
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
 *   npx medusa exec ./src/scripts/setup-sendcloud-shipping.ts zone=France
 *
 * En production le projet est compile : viser le .js plutot que le .ts.
 */
export default async function setupSendcloudShipping({ container, args }: ExecArgs) {
  // Selection explicite, pour les environnements qui comptent plusieurs zones ou
  // plusieurs entrepots : `zone=France` et `emplacement=Golden Vape`.
  const demande = (prefixe: string) =>
    (args ?? []).find((a) => a.startsWith(`${prefixe}=`))?.slice(prefixe.length + 1)
  const zoneDemandee = demande("zone")
  const emplacementDemande = demande("emplacement")

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  // 1. Emplacement, zone de service et profil : les trois rattachements d'une option.
  const { data: emplacements } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "fulfillment_providers.id", "sales_channels.id"],
  })
  const emplacement = emplacementDemande
    ? emplacements.find((e) => e.name === emplacementDemande)
    : emplacements[0]

  if (!emplacement) {
    console.error(
      emplacementDemande
        ? `❌ Aucun emplacement nommé « ${emplacementDemande} ».`
        : "❌ Aucun emplacement de stock. En créer un dans l'administration d'abord."
    )
    return
  }

  // Choisir en silence quand plusieurs existent, c'est rattacher l'offre au mauvais
  // entrepot sans que personne ne s'en apercoive. Mieux vaut refuser et demander.
  if (!emplacementDemande && emplacements.length > 1) {
    console.error(
      `❌ ${emplacements.length} emplacements de stock. Preciser lequel :\n` +
        emplacements.map((e) => `      emplacement=${e.name}`).join("\n")
    )
    return
  }

  const zones = await fulfillment.listServiceZones({}, { take: 50 })
  const zone = zoneDemandee ? zones.find((z) => z.name === zoneDemandee) : zones[0]

  if (!zone) {
    console.error(
      zoneDemandee
        ? `❌ Aucune zone nommée « ${zoneDemandee} ».`
        : "❌ Aucune zone de service. En créer une sur l'ensemble d'expédition."
    )
    return
  }

  if (!zoneDemandee && zones.length > 1) {
    console.error(
      `❌ ${zones.length} zones de service. Preciser laquelle :\n` +
        zones.map((z) => `      zone=${z.name}`).join("\n")
    )
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

  // Appariement par code de service, non par nom : renommer une option doit la renommer,
  // pas en creer une seconde en laissant la premiere en vente. Le nom est une etiquette,
  // le code est l'identite.
  const parCodeExistant = new Map<string, typeof existantes>()
  for (const option of existantes) {
    const code = (option.data as { shipping_option_code?: string } | null)?.shipping_option_code
    if (!code) continue
    parCodeExistant.set(code, [...(parCodeExistant.get(code) ?? []), option])
  }

  console.info("")

  for (const entree of OFFRE) {
    const service = parCode.get(entree.code)

    if (!service) {
      console.error(`   ❌ « ${entree.nom} » : le service ${entree.code} n'est pas proposé.`)
      continue
    }

    // Une option deja creee voit son nom et son `data` rafraichis plutot qu'ignores :
    // c'est ce `data` que le tunnel de commande relit, il doit suivre ce que le provider
    // expose aujourd'hui.
    const [existante, ...doublons] = parCodeExistant.get(entree.code) ?? []

    if (existante) {
      const aRenommer = existante.name !== entree.nom
      const aRafraichir = JSON.stringify(existante.data) !== JSON.stringify(service)

      if (aRenommer || aRafraichir) {
        await fulfillment.updateShippingOptions(existante.id, {
          name: entree.nom,
          data: service,
        })
        console.info(
          aRenommer
            ? `   ↻ « ${existante.name} » renommée « ${entree.nom} ».`
            : `   ↻ « ${entree.nom} » : données rafraîchies.`
        )
      } else {
        console.info(`   « ${entree.nom} » a jour.`)
      }

      // Un meme service ne doit exister qu'une fois : les doublons herites d'un
      // renommage precedent sont retires de la vente plus bas.
      for (const doublon of doublons) {
        console.info(`   ⚠ doublon sur ${entree.code} : « ${doublon.name} ».`)
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

  // Visibilite en boutique.
  //
  // Medusa n'a pas de drapeau « actif » sur une option : c'est une regle
  // `enabled_in_store` qui la gouverne, comparee au contexte que la boutique transmet en
  // listant les options d'un panier. Poser la regle a « false » retire l'option de la
  // vente sans rien supprimer — ni son historique, ni les commandes qui s'en servent.
  const options = await fulfillment.listShippingOptions(
    { service_zone: { id: zone.id } },
    { relations: ["rules"] }
  )

  // Le script fait autorite sur l'offre : une option de la zone absente de la liste est
  // retiree de la vente. C'est ce qui rattrape les renommages, qui creent une option et
  // laissent l'ancienne en place, visible et concurrente.
  const attendus = new Map(
    OFFRE.map((entree) => [entree.nom, entree.actif === false ? "false" : "true"])
  )

  for (const option of options) {
    const attendu = attendus.get(option.name) ?? "false"
    const nom = option.name
    const regle = (option.rules ?? []).find((r) => r.attribute === "enabled_in_store")
    const actuel = regle ? String(regle.value) : "true"

    if (actuel === attendu) continue

    if (regle) {
      // La mise a jour exige la regle entiere : passer le seul champ modifie fait echouer
      // la validation sur « Rule must have an attribute, an operator and a value ».
      await fulfillment.updateShippingOptionRules([
        {
          id: regle.id,
          attribute: "enabled_in_store",
          operator: "eq",
          value: attendu,
        },
      ])
    } else {
      await fulfillment.createShippingOptionRules([
        {
          shipping_option_id: option.id,
          attribute: "enabled_in_store",
          operator: "eq",
          value: attendu,
        },
      ])
    }

    console.info(
      `   ${attendu === "true" ? "◉" : "○"} « ${nom} » ` +
        (attendu === "true"
          ? "remise en vente."
          : attendus.has(nom)
            ? "retiree de la vente."
            : "retiree de la vente (absente de l'offre).")
    )
  }

  console.info(
    "\nLes prix ne sont pas fixés ici : ils sont demandés à Sendcloud au moment du panier.\n" +
      "Un panier sans poids fait echouer ce calcul — Sendcloud refuse un colis de 0 g."
  )
}
