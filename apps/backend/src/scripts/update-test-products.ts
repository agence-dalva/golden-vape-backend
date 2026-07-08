import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import ProductAttributeModuleService from "../modules/product-attribute/service"

const LONG_DESCRIPTION = `Le e-liquide Fraise 50ml capture tout le croquant d'une fraise fraîchement cueillie, sublimé par une pointe de sucre qui adoucit chaque bouffée sans jamais la rendre écœurante.

Formulé en 50PG/50VG, il convient aussi bien à une inhalation directe qu'indirecte et se marie parfaitement avec les clearomiseurs sub-ohm comme les résistances classiques MTL.

Fabriqué en France dans le respect des normes TPD, ce flacon de 50ml en format court-circuit vous permet d'ajouter vos propres boosters de nicotine selon le dosage souhaité (0, 3 ou 6 mg).

Notes de tête : fraise juteuse et sucre roux.
Notes de fond : une légère fraîcheur qui prolonge le plaisir sans jamais dominer le fruit.`

// Complète les produits de test : ajoute une description longue (pour valider le rendu du texte
// sur la fiche produit) et la caractéristique "Marque" manquante sur l'e-liquide.
export default async function updateTestProducts({ container }: ExecArgs) {
  const productModuleService = container.resolve(Modules.PRODUCT)
  const attributeService: ProductAttributeModuleService = container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const products = await productModuleService.listProducts(
    { title: { $like: "[TEST]%" } } as any,
    { select: ["id", "title"] }
  )
  const eliquide = products.find((p: any) => p.title.includes("E-liquide"))
  const mod = products.find((p: any) => p.title.includes("Kit Mod"))

  if (eliquide) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: eliquide.id },
        update: { description: LONG_DESCRIPTION },
      },
    })
    console.log(`Description ajoutée : ${eliquide.title}`)

    const attributeTypes = await attributeService.listAttributeTypes({ name: "Marque" })
    const marqueType = attributeTypes[0] as any
    if (marqueType) {
      const already = await attributeService.listProductAttributeValues({
        product_id: eliquide.id,
        attribute_type_id: marqueType.id,
      })
      if (already.length === 0) {
        await attributeService.createProductAttributeValues({
          product_id: eliquide.id,
          attribute_type_id: marqueType.id,
          value: "Pulp",
        })
        console.log(`Marque ajoutée : Pulp (${eliquide.title})`)
      } else {
        console.log(`Marque déjà présente sur ${eliquide.title}, ignoré`)
      }
    } else {
      console.warn(`Type "Marque" introuvable`)
    }
  }

  if (mod) {
    console.log(`${mod.title} déjà à jour (Marque présente, pas de description longue demandée)`)
  }

  console.log("\nTerminé.")
}
