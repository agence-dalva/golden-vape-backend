import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import ProductAttributeModuleService from "../modules/product-attribute/service"

/*
  Données de test pour valider l'affichage des sous-titres — carte, fiche produit,
  autocomplétion — sans se brancher sur la base de production. Réservé au développement local.

  La ligne sous le titre suit une règle à trois cas, que ce jeu de données couvre :
    - sous-titre renseigné            -> il s'affiche (MOTS_CLES ci-dessous) ;
    - pas de sous-titre, attributs    -> repli sur la caractéristique (REPLI) ;
    - ni l'un ni l'autre              -> rien du tout, pas de ligne vide.

  Le premier produit porte les deux : il vérifie que le sous-titre l'emporte.

  Idempotent : relancer le script réécrit les mêmes valeurs.
*/

// Des mots-clés que le titre ne contient pas — c'est tout l'intérêt du champ : « glaciale »,
// « débutant » ou « étanche » ne se trouvent que là, et doivent suffire à retrouver le produit.
const MOTS_CLES: Record<string, string> = {
  // Format de production : des segments séparés par des tirets, chacun cherchable seul.
  "la-menthe-polaire-10-ml-pulp-84": "Fruits rouges - Cerise - Frais",
  "armour-gs-dtl-vaporesso-2013": "Kit débutant - Grosse vapeur - DTL - Batterie intégrée",
  "cartouche-apex-x2-vaporesso-2158": "Résistance mesh - Remplacement - Compatible Apex X2",
  "accu-18650-3000mah-kuurve-2457": "Accu rechargeable - 18650 - Haute décharge",
  "adaptateur-secteur-1a-eleaf-547": "Chargeur secteur - Prise murale - USB",
  "box-aegis-legend-5-geekvape-2312": "Box mod - Étanche - Antichoc - Double accu",
}

// Caractéristiques seules, sans sous-titre : la carte doit retomber sur elles.
const REPLI: Record<string, [string, string[]][]> = {
  "1642-10ml-montreal-original-1888": [
    ["Contenance", ["10ml"]],
    ["Dosage PG/VG", ["50PG/50VG"]],
    ["Marque", ["Montreal Original"]],
  ],
  "al-k-pomme-50ml-cirkus-2269": [
    ["Contenance", ["50ml"]],
    ["Saveur", ["Fruités"]],
    ["Marque", ["Cirkus"]],
  ],
}

// Le produit qui cumule les deux : le sous-titre doit masquer la caractéristique.
const CUMUL: Record<string, [string, string[]][]> = {
  "la-menthe-polaire-10-ml-pulp-84": [
    ["Contenance", ["10ml"]],
    ["Saveur", ["Frais"]],
  ],
}

export default async function seedTestSubtitles({ container }: ExecArgs) {
  const productModule = container.resolve(Modules.PRODUCT)
  const attributeService: ProductAttributeModuleService =
    container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const handles = [
    ...Object.keys(MOTS_CLES),
    ...Object.keys(REPLI),
    ...Object.keys(CUMUL),
  ]
  const products = await productModule.listProducts(
    { handle: handles },
    { select: ["id", "handle", "title"] }
  )
  const idByHandle = new Map(products.map((p) => [p.handle, p.id]))

  for (const handle of new Set(handles)) {
    if (!idByHandle.has(handle)) {
      console.warn(`⚠  ${handle} : introuvable dans cette base, ignoré`)
    }
  }

  console.log("\nSous-titres :")
  for (const [handle, subtitle] of Object.entries(MOTS_CLES)) {
    const id = idByHandle.get(handle)
    if (!id) continue

    await updateProductsWorkflow(container).run({
      input: { selector: { id }, update: { subtitle } },
    })
    console.log(`  ✔ ${handle}\n      « ${subtitle} »`)
  }

  const attributeTypes = await attributeService.listAttributeTypes({})
  const typeByName = new Map(attributeTypes.map((type) => [type.name, type]))

  async function assign(handle: string, entries: [string, string[]][]) {
    const id = idByHandle.get(handle)
    if (!id) return

    // Relancer le script ne doit pas empiler les valeurs : on repart des mêmes.
    const existing = await attributeService.listProductAttributeValues({ product_id: id })
    if (existing.length > 0) {
      await attributeService.deleteProductAttributeValues(existing.map((value) => value.id))
    }

    for (const [typeName, values] of entries) {
      const type = typeByName.get(typeName)
      if (!type) {
        console.warn(`  ⚠ type « ${typeName} » absent, ignoré — lancer seed-attribute-types`)
        continue
      }
      for (const value of values) {
        await attributeService.createProductAttributeValues({
          product_id: id,
          attribute_type_id: type.id,
          value,
        })
      }
    }
    console.log(`  ✔ ${handle} : ${entries.map(([t, v]) => `${t} = ${v.join(", ")}`).join(" | ")}`)
  }

  console.log("\nCaractéristiques sans sous-titre (repli attendu sur la carte) :")
  for (const [handle, entries] of Object.entries(REPLI)) {
    await assign(handle, entries)
  }

  console.log("\nCaractéristiques ET sous-titre (le sous-titre doit l'emporter) :")
  for (const [handle, entries] of Object.entries(CUMUL)) {
    await assign(handle, entries)
  }

  console.log("\nTerminé.")
}
