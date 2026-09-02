import { Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * Descriptions affichées sur les cartes du catalogue, rapprochées sur le nom de catégorie —
 * les handles portent un suffixe issu de l'import Hiboutik, variable d'une base à l'autre.
 *
 * Le storefront ne les affiche que sur les familles sans sous-catégorie, où la carte
 * paraîtrait sinon vide. Les autres sont renseignées quand même : une famille peut perdre
 * ses sous-catégories, et la description prendra alors le relais sans intervention.
 *
 * À lancer depuis apps/backend :
 *   npx medusa exec ./src/scripts/seed-category-descriptions.ts
 */
const DESCRIPTIONS: Record<string, string> = {
  liquides: "Fruités, gourmands, classics et frais",
  kits: "Kits complets, prêts à vaper",
  diy: "Composez vos propres e-liquides",
  chargeurs: "Chargeurs USB et adaptateurs",
  destockage: "Nos offres en série limitée",
  cbd: "Découvrez notre sélection CBD",
  "puffs rechargeables": "Formats pratiques et rechargeables",
  "clearomiseurs et dripper": "Clearomiseurs et reconstructibles",
  accus: "Accus et accessoires de sécurité",
  resistances: "Trouvez la résistance compatible",
  mods: "Box et batteries",
  "pyrex et reconstructibles": "Pyrex, outils et matériaux",
  accessoires: "Tout pour compléter votre matériel",
}

function simplify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

export default async function seedCategoryDescriptions({ container }: ExecArgs) {
  const productModule = container.resolve(Modules.PRODUCT)

  const categories = await productModule.listProductCategories(
    { parent_category_id: null },
    { select: ["id", "name", "description"], take: 200 }
  )

  const updates: { id: string; description: string }[] = []
  const missing: string[] = []

  for (const category of categories as { id: string; name: string; description: string | null }[]) {
    const description = DESCRIPTIONS[simplify(category.name)]

    if (!description) {
      missing.push(category.name)
      continue
    }
    // Idempotent : une description déjà à jour n'est pas réécrite, et une description
    // saisie à la main dans l'administration n'est pas écrasée.
    if ((category.description ?? "") === description) continue
    if (category.description) {
      console.log(`~ ${category.name} : description déjà renseignée, laissée en l'état`)
      continue
    }

    updates.push({ id: category.id, description })
  }

  for (const update of updates) {
    await productModule.updateProductCategories(update.id, { description: update.description })
    const category = categories.find((c) => c.id === update.id)
    console.log(`✓ ${category?.name} → « ${update.description} »`)
  }

  console.log(`\n${updates.length} catégorie(s) mise(s) à jour.`)
  if (missing.length > 0) {
    console.log(`Sans description prévue : ${missing.join(", ")}`)
  }
}
