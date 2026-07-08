import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  setProductProductOptionsWorkflow,
  createProductVariantsWorkflow,
  deleteProductVariantsWorkflow,
  batchVariantImagesWorkflow,
} from "@medusajs/medusa/core-flows"

// Remplace la variante unique "Default" de [TEST] E-liquide Fraise 50ml par 4 variantes de
// contenance (10ml/30ml/50ml/100ml), chacune avec un prix propre et une image liée distincte
// (réutilise des images déjà présentes sur R2, migrées depuis PrestaShop).
const CONTENANCES = [
  { value: "10ml", sku: "TEST-ELIQUIDE-FRAISE-10ML", amount: 6.9 },
  { value: "30ml", sku: "TEST-ELIQUIDE-FRAISE-30ML", amount: 9.9 },
  { value: "50ml", sku: "TEST-ELIQUIDE-FRAISE-50ML", amount: 12.9 },
  { value: "100ml", sku: "TEST-ELIQUIDE-FRAISE-100ML", amount: 19.9 },
]

export default async function addTestProductVariants({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService = container.resolve(Modules.PRODUCT)

  const { data: products } = await query.graph({
    entity: "product",
    filters: { title: "[TEST] E-liquide Fraise 50ml" },
    fields: ["id", "title", "options.id", "options.title", "variants.id"],
  })
  const product = products[0] as any
  if (!product) {
    console.log("[TEST] E-liquide Fraise 50ml introuvable.")
    return
  }

  const option = product.options[0]
  if (!option) {
    console.log("Aucune option trouvée sur ce produit.")
    return
  }

  // 1. Ajoute les 4 valeurs de contenance à l'option existante ("Titre")
  await setProductProductOptionsWorkflow(container).run({
    input: {
      product_id: product.id,
      update: [
        {
          product_option_id: option.id,
          add: CONTENANCES.map((c) => ({ value: c.value })),
        },
      ],
    },
  })
  console.log(`Valeurs d'option ajoutées : ${CONTENANCES.map((c) => c.value).join(", ")}`)

  // 2. Supprime l'ancienne variante "Default" (sera remplacée par les 4 nouvelles)
  const oldVariantIds = product.variants.map((v: any) => v.id)
  if (oldVariantIds.length > 0) {
    await deleteProductVariantsWorkflow(container).run({ input: { ids: oldVariantIds } })
    console.log(`Ancienne(s) variante(s) supprimée(s) : ${oldVariantIds.length}`)
  }

  // 3. Crée les 4 nouvelles variantes
  const { result: createdVariants } = await createProductVariantsWorkflow(container).run({
    input: {
      product_variants: CONTENANCES.map((c) => ({
        product_id: product.id,
        title: c.value,
        sku: c.sku,
        manage_inventory: true,
        options: { [option.title]: c.value },
        prices: [{ amount: c.amount, currency_code: "eur" }],
      })),
    },
  })
  console.log(`${createdVariants.length} variantes créées.`)

  // 4. Récupère 4 images existantes (déjà sur R2) et les lie chacune à une variante distincte
  const { data: images } = await query.graph({
    entity: "product_image",
    fields: ["id", "url"],
    pagination: { take: 4, skip: 0 },
  })

  if (images.length < CONTENANCES.length) {
    console.log(`Seulement ${images.length} image(s) disponible(s), liaison partielle.`)
  }

  for (let i = 0; i < createdVariants.length; i++) {
    const image = images[i % images.length] as any
    if (!image) continue
    await batchVariantImagesWorkflow(container).run({
      input: { variant_id: createdVariants[i].id, add: [image.id] },
    })
    console.log(`  ${CONTENANCES[i].value} -> image ${image.id} (${image.url})`)
  }

  console.log("\nTerminé.")
}
