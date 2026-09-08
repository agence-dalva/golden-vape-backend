import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_ATTRIBUTE_MODULE } from "../modules/product-attribute"
import type ProductAttributeModuleService from "../modules/product-attribute/service"

/*
  Retire la marque entre crochets du titre des produits.

  « Abricot Fraise Mangue 50ml [Nektar] » → « Abricot Fraise Mangue 50ml »

  Simulation par défaut : rien n'est écrit tant que `appliquer` n'est pas passé. Le rapport de
  simulation montre exactement ce qui changerait, ainsi que trois signaux qui méritent un
  regard avant d'écrire — les titres qui deviendraient identiques, les crochets qui ne
  nomment pas la marque enregistrée du produit, et les titres qui se videraient.

    npx medusa exec ./src/scripts/retirer-marques-des-titres.ts
    npx medusa exec ./src/scripts/retirer-marques-des-titres.ts limite=1
    npx medusa exec ./src/scripts/retirer-marques-des-titres.ts appliquer
    npx medusa exec ./src/scripts/retirer-marques-des-titres.ts appliquer garder=TEST,PROMO

  Les arguments s'écrivent sans tirets : la commande `medusa exec` retient pour elle tout ce
  qui commence par `--`, et le script ne recevrait rien. Les deux formes sont malgré tout
  acceptées, au cas où.

  Ce qui est retiré, et ce qui ne l'est pas :

  — Un groupe entre crochets n'est retiré que s'il ne commence pas le titre. « [TEST] Kit Mod
    Alpha » garde donc son marqueur, qui n'est pas une marque, tandis que « Cartouches Vibe SE
    Dual Mesh [Vaporesso] (X2) » perd le sien tout en gardant son suffixe.
  — Un contenu sans la moindre lettre est gardé : aucune marque ne s'écrit en chiffres seuls,
    alors que le catalogue y met des formats — « PB2C XTAR [18650] » désigne un accu.
  — La casse n'entre pas en jeu : le contenu du crochet n'est jamais comparé à une liste, il
    est retiré tel qu'il est. « [Pulp] », « [PULP] » et « [pulp] » partent pareillement.
  — `--garder` protège des contenus précis, comparés sans casse ni accents.
  — L'espace qui précède le crochet part avec lui, et les espaces doubles laissés au milieu
    d'un titre sont refermés. Le titre est ensuite débarrassé de ses espaces de bord.
*/

/** Un groupe entre crochets, et l'espace qui le précède. */
const CROCHET = /\s*\[([^\]]*)\]/g

/** Contenus protégés par défaut : ce sont des marqueurs internes, pas des marques. */
const GARDES_PAR_DEFAUT = ["TEST"]

/** Une marque porte toujours au moins une lettre ; un format d'accu, non. */
function sansLettre(contenu: string): boolean {
  return !/\p{L}/u.test(contenu)
}

const LOT = 100

function replier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Titre débarrassé de ses marques entre crochets.
 *
 * Le crochet en tête de titre est conservé : à cette place il ne désigne pas la marque mais
 * qualifie le produit — le catalogue y met ses produits d'essai.
 */
export function retirerMarques(titre: string, gardes: Set<string>): string {
  const nettoye = titre.replace(CROCHET, (correspondance, contenu: string, position: number) => {
    // `position` porte le début de la correspondance, espace compris : un crochet en tête de
    // titre est donc reconnu même si le titre commence par une espace.
    const enTete = titre.slice(0, position).trim() === ""
    if (enTete || sansLettre(contenu) || gardes.has(replier(contenu))) {
      return correspondance
    }
    return ""
  })

  // Les espaces doubles laissés par un retrait en milieu de titre sont refermés.
  return nettoye.replace(/\s{2,}/g, " ").trim()
}

export default async function retirerMarquesDesTitres({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const options = new Map(
    (args ?? []).map((argument) => {
      const nu = argument.replace(/^--/, "")
      const separateur = nu.indexOf("=")
      return separateur === -1
        ? [nu, ""]
        : [nu.slice(0, separateur), nu.slice(separateur + 1)]
    })
  )

  const appliquer = options.has("appliquer")
  const limite = Number(options.get("limite")) || 0
  const gardes = new Set(
    (options.get("garder")?.split(",") ?? GARDES_PAR_DEFAUT).map(replier).filter(Boolean)
  )

  /*
    Tous les produits, publiés ou non : un brouillon publié plus tard porterait sinon encore
    sa marque dans le titre.
  */
  const { data: produits } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status"],
    pagination: { take: 10000, skip: 0 },
  })

  /*
    La marque enregistrée, lue par le module qui la porte — elle ne vit pas sur le produit, et
    `query.graph` la rendait silencieusement vide. Elle ne sert qu'au rapport : c'est le titre
    qui décide, jamais l'attribut.
  */
  const attributs: ProductAttributeModuleService = container.resolve(PRODUCT_ATTRIBUTE_MODULE)
  const marqueParProduit = new Map<string, string>()
  const [typeMarque] = await attributs.listAttributeTypes({ name: "Marque" })
  if (typeMarque) {
    const valeurs = (await attributs.listProductAttributeValues({
      attribute_type_id: typeMarque.id,
    })) as { product_id: string; value: string }[]
    for (const valeur of valeurs) {
      marqueParProduit.set(valeur.product_id, valeur.value)
    }
  }

  type Changement = {
    id: string
    avant: string
    apres: string
    retires: string[]
    marqueEnregistree: string | null
  }

  const changements: Changement[] = []
  const videraient: Changement[] = []

  for (const produit of produits as { id: string; title: string; status: string }[]) {
    const apres = retirerMarques(produit.title, gardes)
    if (apres === produit.title) continue

    const retires = [...produit.title.matchAll(CROCHET)]
      .map((m) => m[1].trim())
      .filter((contenu) => !sansLettre(contenu) && !gardes.has(replier(contenu)))

    const marqueEnregistree = marqueParProduit.get(produit.id) ?? null

    const changement = { id: produit.id, avant: produit.title, apres, retires, marqueEnregistree }
    // Un titre vide ferait disparaître le produit de toute liste : on ne l'écrit jamais.
    if (apres === "") videraient.push(changement)
    else changements.push(changement)
  }

  const retenus = limite > 0 ? changements.slice(0, limite) : changements

  logger.info("")
  logger.info(`  ${produits.length} produits lus, ${changements.length} à renommer.`)
  if (limite > 0) {
    logger.info(`  --limite=${limite} : ${retenus.length} traité(s) sur les ${changements.length}.`)
  }
  logger.info(
    `  Contenus protégés : ${[...gardes].join(", ") || "aucun"}, plus tout contenu sans lettre`
  )

  // Ce qui part, du plus fréquent au moins fréquent.
  const parContenu = new Map<string, number>()
  for (const changement of retenus) {
    for (const contenu of changement.retires) {
      parContenu.set(contenu, (parContenu.get(contenu) ?? 0) + 1)
    }
  }
  const classes = [...parContenu.entries()].sort((a, b) => b[1] - a[1])
  logger.info("")
  logger.info(`  ${classes.length} marques distinctes retirées :`)
  for (const [contenu, nombre] of classes.slice(0, 15)) {
    logger.info(`    ${String(nombre).padStart(4)} × [${contenu}]`)
  }
  if (classes.length > 15) {
    logger.info(`    … et ${classes.length - 15} autres`)
  }

  logger.info("")
  logger.info("  Aperçu :")
  for (const changement of retenus.slice(0, 8)) {
    logger.info(`    ${changement.avant}`)
    logger.info(`      → ${changement.apres}`)
  }

  /*
    Trois signaux à regarder avant d'écrire. Aucun n'arrête le script — sauf les titres vides,
    qui sont écartés d'office — mais chacun peut changer la décision.
  */
  const collisions = new Map<string, number>()
  for (const changement of retenus) {
    collisions.set(changement.apres, (collisions.get(changement.apres) ?? 0) + 1)
  }
  const doublons = [...collisions.entries()].filter(([, nombre]) => nombre > 1)

  const desaccords = retenus.filter(
    (changement) =>
      changement.marqueEnregistree !== null &&
      !changement.retires.some(
        (contenu) => replier(contenu) === replier(changement.marqueEnregistree!)
      )
  )

  logger.info("")
  logger.info("  À vérifier :")
  logger.info(
    `    ${doublons.length} titre(s) porté(s) par plusieurs produits après retrait` +
      (doublons.length ? ` — ex. « ${doublons[0][0]} » ×${doublons[0][1]}` : "")
  )
  logger.info(
    `    ${desaccords.length} produit(s) dont le crochet ne nomme pas la marque enregistrée`
  )
  if (desaccords.length) {
    for (const changement of desaccords.slice(0, 5)) {
      logger.info(
        `      [${changement.retires.join("] [")}] retiré, attribut Marque = « ${changement.marqueEnregistree} »`
      )
    }
    logger.info(
      `    ⚠ Si l'attribut Marque n'est pas fiable, le crochet est la seule trace de la marque.`
    )
  }
  if (videraient.length) {
    logger.info(`    ${videraient.length} titre(s) deviendraient vides — écartés, jamais écrits :`)
    for (const changement of videraient.slice(0, 5)) {
      logger.info(`      « ${changement.avant} »`)
    }
  }

  if (!appliquer) {
    logger.info("")
    logger.info("  Simulation. Rien n'a été écrit — ajouter « appliquer » pour renommer.")
    logger.info("")
    return
  }

  logger.info("")
  logger.info(`  Écriture de ${retenus.length} titre(s)…`)

  // Par lots, et par le workflow plutôt que par le module : c'est lui qui émet
  // `product.updated`, l'événement auquel le cache de la recherche est abonné.
  let ecrits = 0
  for (let debut = 0; debut < retenus.length; debut += LOT) {
    const lot = retenus.slice(debut, debut + LOT)
    await updateProductsWorkflow(container).run({
      input: { products: lot.map(({ id, apres }) => ({ id, title: apres })) },
    })
    ecrits += lot.length
    logger.info(`    ${ecrits}/${retenus.length}`)
  }

  logger.info("")
  logger.info(`  ${ecrits} titre(s) renommé(s).`)
  logger.info("")
}
