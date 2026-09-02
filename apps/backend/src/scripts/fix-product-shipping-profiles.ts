import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * Rattache au profil d'expédition par défaut les produits qui n'en ont aucun.
 *
 * Sans ce lien, la finalisation du panier échoue sur « The cart items require shipping
 * profiles that are not satisfied by the current shipping methods » — et comme Medusa ne
 * fait ce contrôle qu'après l'encaissement, le client se retrouve débité sans commande.
 *
 * L'import Hiboutik ne pose pas ce lien : les produits créés par ce chemin en sont dépourvus.
 * Le script est idempotent, il ne touche pas aux produits déjà rattachés.
 *
 *   npx medusa exec ./src/scripts/fix-product-shipping-profiles.js
 */
export default async function fixProductShippingProfiles({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })

  const target = profiles.find((profile) => profile.type === "default") ?? profiles[0]

  if (!target) {
    logger.error("Aucun profil d'expédition n'existe : en créer un depuis l'administration.")
    return
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "shipping_profile.id"],
    pagination: { take: 10000, skip: 0 },
  })

  const orphans = products.filter((product) => !product.shipping_profile?.id)

  logger.info(
    `${products.length} produit(s), ${orphans.length} sans profil d'expédition. ` +
      `Cible : « ${target.name} » (${target.id}).`
  )

  if (orphans.length === 0) {
    return
  }

  await link.create(
    orphans.map((product) => ({
      [Modules.PRODUCT]: { product_id: product.id },
      [Modules.FULFILLMENT]: { shipping_profile_id: target.id },
    }))
  )

  logger.info(`${orphans.length} produit(s) rattaché(s) à « ${target.name} ».`)
}
