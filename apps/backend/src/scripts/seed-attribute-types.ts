import { ExecArgs } from "@medusajs/framework/types"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import ProductAttributeModuleService from "../modules/product-attribute/service"

const ATTRIBUTE_TYPES: { name: string; preset_values: string[]; allow_multiple: boolean }[] = [
  {
    name: "Alimentation",
    preset_values: ["1 accu 18650", "1 accu 21700", "2 accus 18650", "2 accus 21700", "Batterie intégrée"],
    allow_multiple: false,
  },
  {
    name: "Autonomie",
    preset_values: ["1500mah", "3000mah", "1800mah", "4400mah", "950mah", "850mah"],
    allow_multiple: false,
  },
  {
    name: "Contenance",
    preset_values: ["10 ml", "20ml", "30ml", "50ml", "100ml", "200ml"],
    allow_multiple: false,
  },
  {
    name: "Dosage PG/VG",
    preset_values: ["50PG/50VG", "30PG/70VG", "20PG/80VG", "100VG"],
    allow_multiple: false,
  },
  {
    name: "Drip Tip",
    preset_values: ["510", "810", "Drip Propriétaire"],
    allow_multiple: false,
  },
  {
    name: "Inhalation",
    preset_values: ["Directe ou Indirecte", "Directe DL", "Indirecte MTL"],
    allow_multiple: false,
  },
  {
    name: "Marque",
    preset_values: [
      "Geek Vape", "Lost Vape", "Vaporesso", "Innokin", "Aspire", "BD Vape", "Dot Mod",
      "Arômes & Liquide", "Arômes & Secrets", "Artefact", "Cirkus", "Cocori Kush", "Dictator",
      "E-Tasty", "Eleaf", "Elikuid", "Enfer", "Figther fuel", "Flavor Hit", "Fruizee",
      "Furiosa Doctor Vapor", "Furiosa Eggz", "Furiosa Omen", "Furiosa Skinz", "Gang Organise",
      "Granita", "Hell Vape", "Ice cool", "IceBerg", "Joytech", "Justfog", "Kuix", "Kung Fruits",
      "Le Petit Verger", "Le Pod by pulp", "Lemon'Time", "Les jus de Nicole", "Lips",
      "Mexican Cartel", "Millesime", "Mintaïa", "Miv Distrib", "Modjo Vapor", "Moonshiner",
      "Nektar", "Numbers", "Polaris", "Pulp", "Saint-Flava", "Saiyen Vapors", "Salt E-Vapor",
      "Savourea Classique", "Shojo", "Smok", "Swoke", "T-Juice", "Vampire Vape", "Vape City",
      "Vape Legend", "Vaponaute", "Vincent", "WoW Candy juice", "X Calibre", "Pulp Super Frost",
    ],
    allow_multiple: false,
  },
  {
    name: "Origine",
    preset_values: ["France", "Belgique", "Chine"],
    allow_multiple: false,
  },
  {
    name: "Réservoir",
    preset_values: ["2ml", "3ml", "4ml", "4.5ml", "5ml", "8ml"],
    allow_multiple: false,
  },
  {
    name: "Saveur",
    preset_values: ["Tabac", "Fruités", "Fruités Frais", "Gourmands", "Menthes", "Boissons", "Tabac Gourmand"],
    allow_multiple: false,
  },
  {
    name: "Taux de nicotine",
    preset_values: ["0 mg", "3 mg", "6 mg", "12 mg", "10 mg NS", "5 mg NS", "20 mg NS"],
    allow_multiple: true,
  },
]

// Seed les types de caractéristiques (module product-attribute) pour éviter la saisie manuelle
// dans l'admin. Idempotent et non-destructif :
// - un type absent est créé avec toutes ses valeurs
// - un type déjà présent (même nom) est FUSIONNÉ : les valeurs manquantes sont ajoutées,
//   aucune valeur existante n'est jamais retirée (des produits peuvent déjà les utiliser)
export default async function seedAttributeTypes({ container }: ExecArgs) {
  const service: ProductAttributeModuleService = container.resolve(PRODUCT_ATTRIBUTE_MODULE)

  const existing = await service.listAttributeTypes({})
  const existingByName = new Map(existing.map((t: any) => [t.name, t]))

  let created = 0
  let merged = 0

  for (const t of ATTRIBUTE_TYPES) {
    const existingType = existingByName.get(t.name) as any

    if (!existingType) {
      await service.createAttributeTypes({
        name: t.name,
        preset_values: t.preset_values as any,
        allow_multiple: t.allow_multiple,
      })
      created++
      console.log(`✔ créé : ${t.name} (${t.preset_values.length} valeurs)`)
      continue
    }

    const currentValues: string[] = Array.isArray(existingType.preset_values)
      ? existingType.preset_values
      : []
    const missingValues = t.preset_values.filter((v) => !currentValues.includes(v))

    if (missingValues.length === 0) {
      console.log(`— inchangé : ${t.name} (déjà à jour)`)
      continue
    }

    await service.updateAttributeTypes({
      id: existingType.id,
      preset_values: [...currentValues, ...missingValues] as any,
    })
    merged++
    console.log(`✔ complété : ${t.name} (+${missingValues.length} valeurs, ${currentValues.length} conservées)`)
  }

  console.log(`\n${created} créés, ${merged} complétés, ${ATTRIBUTE_TYPES.length - created - merged} déjà à jour.`)
}
