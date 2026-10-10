import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductVariantWorkflowEvents,
  ProductWorkflowEvents,
} from "@medusajs/framework/utils"
import { updateProductsWorkflow, updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { poidsManquants, type ProduitLu } from "../lib/poids-catalogue"

/*
  Rend expédiable tout produit entré par l'administration : un profil d'expédition et un poids.

  Le formulaire de création laisse l'un et l'autre vides si le marchand n'y touche pas, et les
  deux manques coûtent cher :
  — sans profil, Medusa ne transmet pas l'article au provider de livraison, qui croit le panier
    vide et rend 0 € — la livraison est offerte sans que personne l'ait décidé. Et la
    finalisation, qui exige ce profil, échoue après l'encaissement : client débité, pas de
    commande ;
  — sans poids, Sendcloud refuse le devis et le mode de livraison devient inutilisable.

  Le profil est le profil par défaut ; le poids vient de la grille du catalogue, la même que
  celle du script `appliquer-poids-catalogue`. Rien de ce que le marchand a choisi n'est
  remplacé : ni un autre profil, ni un poids saisi à la main.

  La mise à jour compte autant que la création : le poids dépend des catégories, souvent
  posées après coup. Écrire un poids réémet `product.updated`, mais le second passage ne trouve
  plus rien à poser et s'arrête là. Les mises à jour de variantes ne sont pas écoutées : la
  synchronisation Hiboutik en émet par milliers, et une variante modifiée garde son poids.
*/
export default async function produitExpediable({
  event,
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const produitId =
    event.name === ProductVariantWorkflowEvents.CREATED
      ? (
          await query.graph({
            entity: "product_variant",
            filters: { id: event.data.id },
            fields: ["product_id"],
          })
        ).data[0]?.product_id
      : event.data.id

  if (!produitId) {
    return
  }

  const {
    data: [produit],
  } = await query.graph({
    entity: "product",
    filters: { id: produitId },
    fields: [
      "id",
      "title",
      "status",
      "weight",
      "shipping_profile.id",
      "categories.name",
      "variants.id",
      "variants.title",
      "variants.weight",
      "variants.options.value",
      "variants.options.option.title",
    ],
  })

  if (!produit) {
    return
  }

  if (!produit.shipping_profile?.id) {
    await rattacherAuProfilParDefaut(container, produit.id, produit.title)
  }

  const poids = poidsManquants(produit as unknown as ProduitLu)

  if (poids.variantes.length > 0) {
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: poids.variantes.map((v) => ({ id: v.id, weight: v.poids })) },
    })
  }

  if (poids.produit !== null) {
    await updateProductsWorkflow(container).run({
      input: { products: [{ id: produit.id, weight: poids.produit }] },
    })
  }

  if (poids.variantes.length > 0 || poids.produit !== null) {
    logger.info(
      `Produit « ${produit.title} » pesé d'après la grille : ` +
        [
          poids.produit !== null ? `produit ${poids.produit} g` : null,
          poids.variantes.length ? `${poids.variantes.length} déclinaison(s)` : null,
        ]
          .filter(Boolean)
          .join(", ") +
        "."
    )
  }
}

async function rattacherAuProfilParDefaut(
  container: SubscriberArgs<unknown>["container"],
  produitId: string,
  titre: string
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: profils } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })
  const cible = profils.find((p) => p.type === "default") ?? profils[0]

  if (!cible) {
    logger.error(`Produit « ${titre} » sans profil d'expédition, et aucun profil n'existe.`)
    return
  }

  await link.create({
    [Modules.PRODUCT]: { product_id: produitId },
    [Modules.FULFILLMENT]: { shipping_profile_id: cible.id },
  })

  logger.info(`Produit « ${titre} » rattaché au profil d'expédition « ${cible.name} ».`)
}

export const config: SubscriberConfig = {
  event: [
    ProductWorkflowEvents.CREATED,
    ProductWorkflowEvents.UPDATED,
    ProductVariantWorkflowEvents.CREATED,
  ],
}
