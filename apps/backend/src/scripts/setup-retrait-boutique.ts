import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import {
  createLocationFulfillmentSetWorkflow,
  createShippingOptionsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  RETRAIT_BOUTIQUE_CODE,
  RETRAIT_BOUTIQUE_DESCRIPTION,
  RETRAIT_BOUTIQUE_NOM,
} from "../lib/retrait-boutique"

// Le fournisseur « manuel » de Medusa, toujours présent : le retrait en boutique ne passe
// jamais par Sendcloud — ni tarif demandé, ni étiquette, ni point relais.
const PROVIDER_ID = "manual_manual"

/**
 * Met en place le retrait en boutique.
 *
 * Medusa connaît le retrait nativement : une option rattachée à un ensemble d'expédition de
 * type « pickup ». L'administration en tire d'elle-même le bon parcours — « En attente de
 * retrait » puis « Marquer comme retiré » au lieu de « Créer l'expédition ».
 *
 * Ensemble, zone et option sont créés à part de ceux de Sendcloud : le script Sendcloud fait
 * autorité sur sa zone et retirerait de la vente toute option qu'il ne connaît pas.
 *
 * Rejouable : ce qui existe déjà est laissé en place, l'option voit seulement son nom et sa
 * description remis à jour.
 *
 *   npx medusa exec ./src/scripts/setup-retrait-boutique.ts
 *   npx medusa exec ./src/scripts/setup-retrait-boutique.ts emplacement="Golden Vape"
 *
 * En production le projet est compilé : viser le .js plutôt que le .ts.
 */
export default async function setupRetraitBoutique({ container, args }: ExecArgs) {
  const emplacementDemande = (args ?? [])
    .find((a) => a.startsWith("emplacement="))
    ?.slice("emplacement=".length)

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  // 1. L'emplacement : c'est sa propre adresse que le client verra comme lieu de retrait.
  const { data: emplacements } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "address.address_1",
      "address.postal_code",
      "address.city",
      "fulfillment_providers.id",
      "fulfillment_sets.id",
      "fulfillment_sets.type",
      "fulfillment_sets.name",
    ],
  })

  if (!emplacementDemande && emplacements.length > 1) {
    console.error(
      `❌ ${emplacements.length} emplacements de stock. Préciser lequel :\n` +
        emplacements.map((e) => `      emplacement=${e.name}`).join("\n")
    )
    return
  }

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

  const adresse = emplacement.address
  console.info(`Emplacement : ${emplacement.name}`)

  // Sans adresse, le client ne saurait pas où venir : la boutique l'affiche telle quelle.
  if (!adresse?.address_1 || !adresse.city) {
    console.error(
      "❌ L'emplacement n'a pas d'adresse complète. La renseigner dans Paramètres → Emplacements :\n" +
        "   c'est elle qui s'affiche au client comme lieu de retrait."
    )
    return
  }
  console.info(`Adresse     : ${adresse.address_1}, ${adresse.postal_code ?? ""} ${adresse.city}`)

  // 2. Le fournisseur manuel doit être rattaché à l'emplacement, sinon l'option ne se crée pas.
  const fournisseurRattache = (emplacement.fulfillment_providers ?? []).some(
    (p) => (p as { id?: string } | null)?.id === PROVIDER_ID
  )
  if (!fournisseurRattache) {
    console.error(
      `❌ Le fournisseur ${PROVIDER_ID} n'est pas rattaché à « ${emplacement.name} ».\n` +
        "   Le rattacher dans Paramètres → Emplacements → Fournisseurs de livraison."
    )
    return
  }

  // 3. L'ensemble de type « pickup ». Un seul par emplacement : on reprend celui qui existe.
  let ensemble = (emplacement.fulfillment_sets ?? []).find(
    (s) => (s as { type?: string } | null)?.type === "pickup"
  ) as { id: string; name: string } | undefined

  if (ensemble) {
    console.info(`Ensemble    : « ${ensemble.name} » (existant)`)
  } else {
    await createLocationFulfillmentSetWorkflow(container).run({
      input: {
        location_id: emplacement.id,
        fulfillment_set_data: { name: `${emplacement.name} retrait`, type: "pickup" },
      },
    })
    const [cree] = await fulfillment.listFulfillmentSets({
      name: `${emplacement.name} retrait`,
      type: "pickup",
    })
    ensemble = cree
    console.info(`✅ Ensemble « ${ensemble.name} » créé.`)
  }

  // 4. La zone : la France entière. Elle décide seulement à qui l'option est proposée, et
  //    tout client livrable en France peut venir chercher sa commande.
  const [zoneExistante] = await fulfillment.listServiceZones({ fulfillment_set: { id: ensemble.id } })
  const zone =
    zoneExistante ??
    (await fulfillment.createServiceZones({
      name: "Boutique",
      fulfillment_set_id: ensemble.id,
      geo_zones: [{ type: "country", country_code: "fr" }],
    }))
  console.info(zoneExistante ? `Zone        : « ${zone.name} » (existante)` : `✅ Zone « ${zone.name} » créée.`)

  // 5. L'option, appariée par son code comme celles de Sendcloud : renommer doit renommer.
  const options = await fulfillment.listShippingOptions(
    { service_zone: { id: zone.id } },
    { relations: ["type"] }
  )
  const existante = options.find((o) => o.type?.code === RETRAIT_BOUTIQUE_CODE)

  if (existante) {
    if (existante.name !== RETRAIT_BOUTIQUE_NOM || existante.type?.description !== RETRAIT_BOUTIQUE_DESCRIPTION) {
      await fulfillment.updateShippingOptions(existante.id, {
        name: RETRAIT_BOUTIQUE_NOM,
        type: {
          label: RETRAIT_BOUTIQUE_NOM,
          description: RETRAIT_BOUTIQUE_DESCRIPTION,
          code: RETRAIT_BOUTIQUE_CODE,
        },
      })
      console.info(`↻ Option « ${RETRAIT_BOUTIQUE_NOM} » mise à jour.`)
    } else {
      console.info(`Option      : « ${RETRAIT_BOUTIQUE_NOM} » à jour.`)
    }
    return
  }

  const profils = await fulfillment.listShippingProfiles({}, { take: 5 })
  const profil = profils.find((p) => p.type === "default") ?? profils[0]
  if (!profil) {
    console.error("❌ Aucun profil de livraison.")
    return
  }

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: RETRAIT_BOUTIQUE_NOM,
        service_zone_id: zone.id,
        shipping_profile_id: profil.id,
        provider_id: PROVIDER_ID,
        // Prix fixe à zéro : rien à demander à un transporteur.
        price_type: "flat",
        prices: [{ currency_code: "eur", amount: 0 }],
        type: {
          label: RETRAIT_BOUTIQUE_NOM,
          description: RETRAIT_BOUTIQUE_DESCRIPTION,
          code: RETRAIT_BOUTIQUE_CODE,
        },
        rules: [
          { attribute: "enabled_in_store", operator: "eq", value: "true" },
          { attribute: "is_return", operator: "eq", value: "false" },
        ],
      },
    ],
  })

  console.info(`✅ Option « ${RETRAIT_BOUTIQUE_NOM} » créée, gratuite, proposée en boutique.`)
}
