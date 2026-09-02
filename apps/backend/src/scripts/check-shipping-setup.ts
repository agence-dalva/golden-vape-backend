import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * État de la configuration de livraison, en lecture seule.
 *
 * Un produit n'est jamais rattaché à un transporteur : il l'est à un PROFIL DE LIVRAISON.
 * Un transporteur (option d'expédition) l'est aussi. La commande n'est finalisable que si,
 * pour chaque article, le profil du produit figure parmi ceux des transporteurs choisis.
 *
 *   produit ──▶ profil de livraison ◀── transporteur
 *
 *   npx medusa exec ./src/scripts/check-shipping-setup.js
 */
export default async function checkShippingSetup({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name", "type"],
  })

  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "shipping_profile_id"],
  })

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "shipping_profile.id"],
    pagination: { take: 10000, skip: 0 },
  })

  const parProfil = new Map<string, number>()
  let orphelins = 0
  for (const product of products) {
    const id = product.shipping_profile?.id
    if (!id) orphelins++
    else parProfil.set(id, (parProfil.get(id) ?? 0) + 1)
  }

  console.info("\nPROFILS DE LIVRAISON")
  for (const profile of profiles) {
    const transporteurs = options
      .filter((option) => option.shipping_profile_id === profile.id)
      .map((option) => option.name)
    console.info(
      `  ${profile.name} (${profile.type})\n` +
        `     produits      : ${parProfil.get(profile.id) ?? 0}\n` +
        `     transporteurs : ${transporteurs.length ? transporteurs.join(", ") : "AUCUN — rien ne pourra être commandé"}`
    )
  }

  const sansProfil = options.filter(
    (option) => !profiles.some((profile) => profile.id === option.shipping_profile_id)
  )
  if (sansProfil.length) {
    console.info(`\n  Transporteurs sans profil valide : ${sansProfil.map((o) => o.name).join(", ")}`)
  }

  console.info(
    `\n  ${products.length} produit(s) au total, ${orphelins} sans profil de livraison.` +
      (orphelins
        ? "\n  ⚠  Ces produits feront échouer la commande APRÈS le paiement.\n" +
          "     Corriger avec : npx medusa exec ./src/scripts/fix-product-shipping-profiles.js\n"
        : "\n  ✅ Tous les produits sont rattachés.\n")
  )
}
