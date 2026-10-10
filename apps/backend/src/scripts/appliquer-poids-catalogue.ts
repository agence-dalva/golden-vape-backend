import { ExecArgs, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow, updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { writeFileSync } from "node:fs"
import {
  evaluer,
  MOTIFS_ECRITS,
  ORDRE_DES_MOTIFS,
  replier,
  type Ligne,
  type ProduitLu,
} from "../lib/poids-catalogue"

/*
  Donne un poids, en grammes, à chaque produit et à chaque variante du catalogue.

  Sans poids, rien n'est expédiable : Sendcloud lit `variant.weight` pour affranchir, et un
  colis sans poids tombe sur le repli configuré ou fait échouer l'affranchissement. Les poids
  sont ceux de la grille du marchand, emballage compris, et ne dépendent jamais du taux de
  nicotine ni de CBD.

  La catégorie du produit décide d'abord :
  — liquides, arômes, boosters, CBD : le poids suit la contenance, lue dans les options de la
    variante, puis dans son titre, puis dans le titre du produit — la première source qui en
    porte une l'emporte ;
  — bases et flacons vides : même principe, avec leur propre grille ;
  — matériel : un forfait par catégorie. La contenance n'y est jamais lue — le « 4ml » d'une
    cartouche est la capacité du réservoir, pas un liquide.

  Quelques déductions, toutes signalées « DEDUIT » dans le rapport :
  — un titre à plusieurs contenances (« Arctic Mango 10ml / 50ml ») vaut pour la plus petite
    quand la variante ne précise rien. Dans le catalogue, le grand format est toujours écrit
    dans la variante (« 0mg 50ml ») et les variantes muettes (« 3mg », « 6mg ») sont le petit —
    vérifié sur les 53 produits concernés ;
  — sans contenance lisible, un booster fait 10 ml (son format légal), un liquide 50 ml, un
    concentré 30 ml, un flacon vide 120 ml — les formats les plus vendus, et jamais les plus
    légers ;
  — le CBD vendu au gramme (fleurs, résines) pèse son grammage plus 15 g d'emballage ; un
    pré-roll 20 g ; le reste du CBD sans grammage 50 g, par prudence.

  Un produit rangé dans deux catégories à poids différents prend le plus lourd : un colis
  sous-évalué est repesé en centre de tri puis refacturé, là où une sur-évaluation ne coûte au
  pire qu'une tranche. Le cas reste signalé.

  Rien n'est écrit quand le poids ne peut pas être établi — contenance hors grille, catégorie
  inconnue ou sans règle. Ces produits sont listés pour une correction à la main. Le
  poids du produit lui-même, quand ses variantes ne s'accordent pas, reste tel quel : c'est une
  valeur d'affichage, Sendcloud ne la lit pas.

  Simulation par défaut : rien n'est écrit tant que `appliquer` n'est pas passé. Le rapport
  montre, produit par produit et variante par variante, l'ancien et le nouveau poids.

    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts
    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts filtre=grapaya
    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts csv=/tmp/poids.csv
    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts appliquer limite=5
    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts appliquer
    npx medusa exec ./src/scripts/appliquer-poids-catalogue.ts appliquer conserver

  `limite=N` traite au plus N produits, avec toutes leurs variantes. `filtre=texte` ne garde
  que les produits dont le titre contient le texte, sans casse ni accents. `csv=chemin` écrit
  le tableau complet dans un fichier et allège la console. `conserver` ne touche pas aux poids
  déjà renseignés — par défaut tout est recalculé, la grille faisant foi.

  Les arguments s'écrivent sans tirets : la commande `medusa exec` retient pour elle tout ce
  qui commence par `--`, et le script ne recevrait rien. Les deux formes sont malgré tout
  acceptées, au cas où.

  Le script est idempotent : relancé, il n'écrit que ce qui a changé. À relancer après une
  synchronisation Hiboutik, qui crée des produits et des variantes sans poids. Les produits
  créés depuis l'administration sont pesés à leur création par le subscriber
  `produit-expediable` ; les règles vivent dans `src/lib/poids-catalogue.ts`.
*/

const LOT = 100

/** Tous les produits, publiés ou non : un brouillon publié plus tard partirait sinon à 0 g. */
async function lireCatalogue(query: Omit<RemoteQueryFunction, symbol>): Promise<ProduitLu[]> {
  const produits: ProduitLu[] = []
  const PAGE = 500
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "status",
        "weight",
        "categories.name",
        "variants.id",
        "variants.title",
        "variants.weight",
        "variants.options.value",
        "variants.options.option.title",
      ],
      pagination: { take: PAGE, skip, order: { id: "ASC" } },
    })
    produits.push(...(data as ProduitLu[]))
    if (data.length < PAGE) break
  }
  return produits
}

function tronquer(texte: string, largeur: number): string {
  return texte.length > largeur ? `${texte.slice(0, largeur - 1)}…` : texte.padEnd(largeur)
}

function grammes(valeur: number | null): string {
  return valeur === null ? "—" : `${valeur} g`
}

/** Hôte et nom de la base de DATABASE_URL, sans identifiants. */
function baseVisee(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "")
    return `${url.hostname}${url.pathname}`
  } catch {
    return "DATABASE_URL illisible"
  }
}

function champCsv(valeur: string | number | null): string {
  const texte = valeur === null ? "" : String(valeur)
  return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte
}

export default async function appliquerPoidsCatalogue({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const options = new Map(
    (args ?? []).map((argument) => {
      const nu = argument.replace(/^--/, "")
      const separateur = nu.indexOf("=")
      return separateur === -1 ? [nu, ""] : [nu.slice(0, separateur), nu.slice(separateur + 1)]
    })
  )

  const appliquer = options.has("appliquer")
  const conserver = options.has("conserver")
  const limite = Number(options.get("limite")) || 0
  const filtre = replier(options.get("filtre") ?? "")
  const cheminCsv = options.get("csv") || null

  /*
    La base visée, en clair et en premier : la CLI charge `.env` avant `medusa-config`, si bien
    qu'un `.env.staging` ne redirige rien — seul un DATABASE_URL passé dans le shell l'emporte.
    Le voir écrit évite de croire qu'on est ailleurs.
  */
  logger.info("")
  logger.info(`  Base : ${baseVisee()}`)

  const lus = await lireCatalogue(query)
  const publies = lus.filter((p) => p.status === "published").length
  const nombreDeVariantes = lus.reduce((somme, p) => somme + (p.variants?.length ?? 0), 0)

  let produits = filtre ? lus.filter((p) => replier(p.title).includes(filtre)) : lus
  if (limite > 0) produits = produits.slice(0, limite)

  const inconnues = new Map<string, number>()
  const groupes = produits.map((produit) => evaluer(produit, inconnues))

  /*
    `conserver` garde tout poids déjà posé : la ligne reste dans le rapport, mais comme
    inchangée, et dit d'où vient sa valeur.
  */
  if (conserver) {
    for (const lignes of groupes) {
      for (const ligne of lignes) {
        if (ligne.ancien !== null && ligne.ancien > 0 && ligne.nouveau !== ligne.ancien) {
          ligne.nouveau = ligne.ancien
          ligne.regle = "conservé"
          ligne.detail = "poids existant conservé (« conserver »)"
          ligne.motifs = []
        }
      }
    }
  }

  // Les produits sont groupés par règle puis par titre ; chaque produit garde ses variantes sous lui.
  groupes.sort((a, b) => a[0].regle.localeCompare(b[0].regle, "fr") || a[0].produit.localeCompare(b[0].produit, "fr"))
  const lignes = groupes.flat()

  const aEcrire = lignes.filter((l) => l.nouveau !== null && l.nouveau !== l.ancien)
  const inchangees = lignes.filter((l) => l.nouveau !== null && l.nouveau === l.ancien)
  const ecartees = lignes.filter((l) => l.nouveau === null)

  logger.info("")
  logger.info(
    `  ${lus.length} produits lus (${publies} publiés, ${lus.length - publies} brouillons), ${nombreDeVariantes} variantes.`
  )
  if (filtre) logger.info(`  filtre=${options.get("filtre")} : ${produits.length} produit(s) retenu(s).`)
  if (limite > 0) logger.info(`  limite=${limite} : ${produits.length} produit(s) traité(s).`)
  if (conserver) logger.info("  conserver : les poids déjà renseignés ne sont pas recalculés.")

  /*
    Le tableau complet, sauf si un CSV le reçoit : la console n'en garde alors qu'un aperçu.
  */
  const enTete = `  ${tronquer("Produit", 48)} ${tronquer("Variante", 16)} ${"Ancien".padStart(7)} ${"Nouveau".padStart(9)}  Règle — détail`
  const formater = (l: Ligne) =>
    `  ${tronquer(l.produit, 48)} ${tronquer(l.variante ?? "", 16)} ${grammes(l.ancien).padStart(7)} ${(l.nouveau === null ? l.motifs.join("+") : grammes(l.nouveau) + (l.nouveau === l.ancien ? " =" : "")).padStart(9)}  ${l.regle} — ${l.detail}`

  logger.info("")
  logger.info(enTete)
  for (const ligne of cheminCsv ? lignes.slice(0, 20) : lignes) {
    logger.info(formater(ligne))
  }
  if (cheminCsv && lignes.length > 20) {
    logger.info(`  … ${lignes.length - 20} autres lignes dans le CSV.`)
  }

  // Ce qui serait écrit, par règle et par poids, du plus fréquent au moins fréquent.
  const parRegle = new Map<string, number>()
  for (const ligne of aEcrire) {
    const cle = `${String(ligne.nouveau).padStart(4)} g   ${ligne.regle}`
    parRegle.set(cle, (parRegle.get(cle) ?? 0) + 1)
  }
  logger.info("")
  logger.info(`  À écrire, par règle (produits et variantes confondus) :`)
  for (const [cle, nombre] of [...parRegle.entries()].sort((a, b) => b[1] - a[1])) {
    logger.info(`    ${String(nombre).padStart(5)} × ${cle}`)
  }

  /*
    Ce qui n'est pas écrit, et pourquoi. Aucun de ces cas n'arrête le script : ce sont des
    produits à reclasser ou à renommer, ou une règle à ajouter.
  */
  if (inconnues.size) {
    logger.info("")
    logger.info(`  ⚠ ${inconnues.size} catégorie(s) inconnue(s) de la grille :`)
    for (const [nom, nombre] of [...inconnues.entries()].sort((a, b) => b[1] - a[1])) {
      logger.info(`    ${String(nombre).padStart(5)} × « ${nom} »`)
    }
  }
  for (const motif of ORDRE_DES_MOTIFS) {
    const concernees = lignes.filter((l) => l.motifs.includes(motif))
    if (concernees.length === 0) continue
    logger.info("")
    logger.info(`  ${motif} — ${concernees.length} ligne(s), ${MOTIFS_ECRITS[motif] ?? "rien d'écrit"} :`)
    for (const l of concernees) {
      const variante = l.variante !== null ? ` / ${l.variante}` : ""
      const categories = l.categories === "—" ? "" : ` — ${l.categories}`
      logger.info(`    « ${l.produit} »${variante} [${l.statut}]${categories} — ${l.detail}`)
    }
  }

  const produitsAEcrire = aEcrire.filter((l) => l.varianteId === null)
  const variantesAEcrire = aEcrire.filter((l) => l.varianteId !== null)

  logger.info("")
  logger.info(
    `  À écrire : ${produitsAEcrire.length} produit(s), ${variantesAEcrire.length} variante(s) ; ` +
      `inchangés : ${inchangees.length} ; écartés : ${ecartees.length}.`
  )

  if (cheminCsv) {
    const colonnes = ["produit", "variante", "statut", "categories", "ancien_g", "nouveau_g", "regle", "detail", "motifs"]
    const contenu = [
      colonnes.join(";"),
      ...lignes.map((l) =>
        [l.produit, l.variante, l.statut, l.categories, l.ancien, l.nouveau, l.regle, l.detail, l.motifs.join("+")]
          .map(champCsv)
          .join(";")
      ),
    ].join("\n")
    writeFileSync(cheminCsv, `﻿${contenu}\n`, "utf8")
    logger.info(`  Tableau complet écrit dans ${cheminCsv} (${lignes.length} lignes).`)
  }

  if (!appliquer) {
    logger.info("")
    logger.info("  Simulation. Rien n'a été écrit — ajouter « appliquer » pour écrire.")
    logger.info("")
    return
  }

  if (aEcrire.length === 0) {
    logger.info("")
    logger.info("  Rien à écrire : tous les poids sont déjà ceux de la grille.")
    logger.info("")
    return
  }

  /*
    Les variantes d'abord, par leur workflow : un poids distinct par variante en un appel, sans
    toucher aux prix tant qu'aucun n'est passé. Les produits ensuite, par le leur — c'est lui
    qui émet `product.updated`, l'événement auquel le cache de la recherche est abonné. Jamais
    les variantes dans la charge du workflow produit : il les traiterait comme un remplacement
    complet, inventaire compris.
  */
  logger.info("")
  logger.info(`  Écriture de ${variantesAEcrire.length} variante(s)…`)
  let ecrites = 0
  for (let debut = 0; debut < variantesAEcrire.length; debut += LOT) {
    const lot = variantesAEcrire.slice(debut, debut + LOT)
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: lot.map((l) => ({ id: l.varianteId!, weight: l.nouveau! })) },
    })
    ecrites += lot.length
    logger.info(`    ${ecrites}/${variantesAEcrire.length}`)
  }

  logger.info("")
  logger.info(`  Écriture de ${produitsAEcrire.length} produit(s)…`)
  let ecrits = 0
  for (let debut = 0; debut < produitsAEcrire.length; debut += LOT) {
    const lot = produitsAEcrire.slice(debut, debut + LOT)
    await updateProductsWorkflow(container).run({
      input: { products: lot.map((l) => ({ id: l.produitId, weight: l.nouveau! })) },
    })
    ecrits += lot.length
    logger.info(`    ${ecrits}/${produitsAEcrire.length}`)
  }

  logger.info("")
  logger.info(`  ${ecrits} produit(s) et ${ecrites} variante(s) mis à jour.`)
  logger.info("")
}
