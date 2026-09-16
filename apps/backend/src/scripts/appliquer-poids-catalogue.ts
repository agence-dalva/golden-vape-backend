import { ExecArgs, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow, updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { writeFileSync } from "node:fs"

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

  Deux déductions, signalées dans le rapport :
  — un titre à plusieurs contenances (« Arctic Mango 10ml / 50ml ») vaut pour la plus petite
    quand la variante ne précise rien. Dans le catalogue, le grand format est toujours écrit
    dans la variante (« 0mg 50ml ») et les variantes muettes (« 3mg », « 6mg ») sont le petit —
    vérifié sur les 53 produits concernés ;
  — un booster sans contenance lisible fait 10 ml : c'est son format légal.

  Un produit rangé dans deux catégories à poids différents prend le plus lourd : un colis
  sous-évalué est repesé en centre de tri puis refacturé, là où une sur-évaluation ne coûte au
  pire qu'une tranche. Le cas reste signalé.

  Rien n'est écrit quand le poids ne peut pas être établi — contenance absente ou hors grille,
  catégorie inconnue ou sans règle. Ces produits sont listés pour une correction à la main. Le
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
  synchronisation Hiboutik, qui crée des produits et des variantes sans poids.
*/

/** Contenance en millilitres → grammes, flacon plein et emballage compris. */
type Grille = Record<number, number>

const GRILLE_LIQUIDE: Grille = {
  10: 25,
  20: 40,
  30: 50,
  50: 75,
  60: 90,
  80: 120,
  100: 140,
  120: 175,
  200: 270,
  250: 335,
}

/** Une base est plus dense qu'un liquide fini, et vendue en grand format. */
const GRILLE_BASE: Grille = { 120: 185, 250: 350 }

/** Un flacon vide ne pèse que son plastique. */
const GRILLE_FLACON: Grille = { 75: 20, 120: 30, 200: 35, 230: 40, 250: 40 }

type Regle =
  | { type: "contenance"; libelle: string; grille: Grille; defaut?: number }
  | { type: "forfait"; libelle: string; grammes: number }

const LIQUIDE: Regle = { type: "contenance", libelle: "Liquide", grille: GRILLE_LIQUIDE }
const BASE: Regle = { type: "contenance", libelle: "Base", grille: GRILLE_BASE }
const FLACON: Regle = { type: "contenance", libelle: "Flacon", grille: GRILLE_FLACON }
/** Un booster de nicotine est un 10 ml : c'est le plus grand format que la loi lui permet. */
const BOOSTER: Regle = { type: "contenance", libelle: "Booster", grille: GRILLE_LIQUIDE, defaut: 10 }

function forfait(libelle: string, grammes: number): Regle {
  return { type: "forfait", libelle, grammes }
}

/*
  Partagés entre plusieurs noms de catégorie — une famille et sa sous-catégorie, ou le même
  rayon nommé autrement d'une base à l'autre — pour ne compter qu'une règle quand un produit
  est rangé dans les deux.
*/
const CLEAROMISEUR = forfait("Clearomiseur", 120)
const MOD = forfait("Mod / Box", 200)

/**
 * Règle par catégorie, sur le nom replié — jamais le handle : il porte un suffixe hérité de
 * l'import PrestaShop, qui change d'une base à l'autre.
 *
 * Les sous-catégories des liquides et des arômes portent la même règle que leur parent : un
 * produit y est en général rangé dans les deux, et « Frais » ou « Tabac » existent sous l'un
 * comme sous l'autre.
 */
const REGLES_PAR_CATEGORIE: Record<string, Regle> = {
  liquides: LIQUIDE,
  frais: LIQUIDE,
  gourmand: LIQUIDE,
  tabac: LIQUIDE,
  "sels de nicotine": LIQUIDE,
  fruite: LIQUIDE,
  boissons: LIQUIDE,
  cbd: LIQUIDE,
  aromes: LIQUIDE,
  gourmands: LIQUIDE,
  fruites: LIQUIDE,
  booster: BOOSTER,
  bases: BASE,
  flacons: FLACON,
  kits: forfait("Kit", 250),
  "puffs rechargeables": forfait("Puff rechargeable", 40),
  resistances: forfait("Résistance", 35),
  "cartouches pods": forfait("Cartouche pod", 35),
  clearomiseurs: CLEAROMISEUR,
  "clearomiseurs et dripper": CLEAROMISEUR,
  "clearomiseurs et reconstructible": CLEAROMISEUR,
  reconstructible: forfait("Reconstructible", 120),
  accus: forfait("Accu", 55),
  mods: MOD,
  "box et batteries": MOD,
  pyrex: forfait("Pyrex", 20),
  chargeurs: forfait("Chargeur", 180),
  "fibres et cotons": forfait("Fibres / coton", 25),
  "fils resistifs": forfait("Fil résistif", 50),
  outils: forfait("Outil", 30),
}

/**
 * Catégories connues mais sans règle propre : des familles et des fourre-tout, où le produit
 * est toujours rangé aussi dans une catégorie qui tranche. Elles ne remontent pas comme
 * inconnues.
 */
const CATEGORIES_SANS_REGLE = new Set([
  "diy",
  "cigarette electronique",
  "accessoires",
  "destockage",
  "pyrex et reconstructibles",
])

/**
 * Une contenance : « 50ml », « 50 ml », « 5.5ml ». Le début interdit d'isoler « 5 » dans
 * « 10.5ml » ; la fin écarte « 30lm » et autres coquilles. « 1litre » n'est pas reconnu, à
 * dessein : aucune grille ne va jusque-là.
 */
const CONTENANCE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*ml(?!\p{L})/giu

const LOT = 100

/** Les quatre premiers empêchent l'écriture ; les deux derniers l'accompagnent d'un avertissement. */
type Motif =
  | "SANS CATEGORIE"
  | "CATEGORIE INCONNUE"
  | "SANS CONTENANCE"
  | "HORS GRILLE"
  | "DEDUIT"
  | "CONFLIT"

const ORDRE_DES_MOTIFS: Motif[] = [
  "SANS CATEGORIE",
  "CATEGORIE INCONNUE",
  "SANS CONTENANCE",
  "HORS GRILLE",
  "DEDUIT",
  "CONFLIT",
]

const MOTIFS_ECRITS: Record<Motif, string | null> = {
  "SANS CATEGORIE": null,
  "CATEGORIE INCONNUE": null,
  "SANS CONTENANCE": null,
  "HORS GRILLE": null,
  DEDUIT: "écrites sur une contenance déduite",
  CONFLIT: "écrites au poids le plus lourd",
}

type Origine = "option" | "titre de la variante" | "titre du produit"

type Source = { texte: string; origine: Origine }

type Pesee = {
  poids: number | null
  regle: string
  detail: string
  motifs: Motif[]
}

function replier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Les contenances distinctes d'un texte, dans l'ordre où elles apparaissent. */
export function contenances(texte: string): number[] {
  const valeurs = [...texte.matchAll(CONTENANCE)].map((m) => Number(m[1].replace(",", ".")))
  return [...new Set(valeurs)]
}

type Contenance =
  /** `deduite` explique un choix qui n'est pas une lecture directe ; le rapport le signale. */
  | { valeur: number; origine: Origine; deduite: string | null }
  | { valeur: null }

/**
 * La contenance retenue parmi plusieurs sources, de la plus précise à la plus générale.
 *
 * La première source qui en porte au moins une décide. Quand elle en porte plusieurs
 * (« 10ml / 50ml »), c'est la plus petite : dans ce catalogue, le grand format est toujours
 * écrit dans la variante, et une variante muette est le petit.
 */
export function contenanceDe(sources: Source[]): Contenance {
  for (const source of sources) {
    const trouvees = contenances(source.texte)
    if (trouvees.length === 1) {
      return { valeur: trouvees[0], origine: source.origine, deduite: null }
    }
    if (trouvees.length > 1) {
      const petite = Math.min(...trouvees)
      return {
        valeur: petite,
        origine: source.origine,
        deduite: `la plus petite parmi ${trouvees.map((v) => `${v} ml`).join(", ")} dans le ${source.origine}`,
      }
    }
  }
  return { valeur: null }
}

/** Les règles portées par des catégories, dédoublonnées, et les noms qu'aucune table ne connaît. */
export function reglesDe(noms: string[]): { regles: Regle[]; inconnues: string[]; sansRegle: string[] } {
  const regles = new Set<Regle>()
  const inconnues: string[] = []
  const sansRegle: string[] = []
  for (const nom of noms) {
    const cle = replier(nom)
    const regle = REGLES_PAR_CATEGORIE[cle]
    if (regle) regles.add(regle)
    else if (CATEGORIES_SANS_REGLE.has(cle)) sansRegle.push(nom)
    else inconnues.push(nom)
  }
  return { regles: [...regles], inconnues, sansRegle }
}

function peser(regle: Regle, sources: Source[]): Pesee {
  if (regle.type === "forfait") {
    return { poids: regle.grammes, regle: regle.libelle, detail: "forfait de la catégorie", motifs: [] }
  }

  let contenance = contenanceDe(sources)
  if (contenance.valeur === null && regle.defaut !== undefined) {
    contenance = {
      valeur: regle.defaut,
      origine: "titre du produit",
      deduite: `${regle.defaut} ml supposés, aucune contenance lisible`,
    }
  }
  if (contenance.valeur === null) {
    return { poids: null, regle: regle.libelle, detail: "aucune contenance lisible", motifs: ["SANS CONTENANCE"] }
  }

  const poids = regle.grille[contenance.valeur]
  if (poids === undefined) {
    return {
      poids: null,
      regle: regle.libelle,
      detail: `${contenance.valeur} ml hors grille (${contenance.origine})`,
      motifs: ["HORS GRILLE"],
    }
  }

  return {
    poids,
    regle: `${regle.libelle} ${contenance.valeur} ml`,
    detail: contenance.deduite ?? `${contenance.valeur} ml, ${contenance.origine}`,
    motifs: contenance.deduite ? ["DEDUIT"] : [],
  }
}

/**
 * Le poids d'un article rangé dans une ou plusieurs catégories.
 *
 * Chaque règle est pesée ; la plus lourde l'emporte, et le désaccord est signalé. Quand aucune
 * n'aboutit, les motifs de toutes sont rendus : c'est eux qui expliquent l'échec.
 */
export function decider(regles: Regle[], sources: Source[]): Pesee {
  const pesees = regles.map((regle) => peser(regle, sources))
  const abouties = pesees.filter((p) => p.poids !== null)

  if (abouties.length === 0) {
    const motifs = [...new Set(pesees.flatMap((p) => p.motifs))]
    return {
      poids: null,
      regle: pesees.map((p) => p.regle).join(" / "),
      detail: [...new Set(pesees.map((p) => p.detail))].join(" ; "),
      motifs,
    }
  }

  abouties.sort((a, b) => b.poids! - a.poids!)
  const retenue = abouties[0]
  const poidsDistincts = new Set(abouties.map((p) => p.poids))
  if (poidsDistincts.size === 1) {
    return retenue
  }

  return {
    ...retenue,
    detail: `conflit : ${abouties.map((p) => `${p.regle} ${p.poids} g`).join(" / ")} — le plus lourd retenu`,
    motifs: [...retenue.motifs, "CONFLIT"],
  }
}

type ProduitLu = {
  id: string
  title: string
  status: string
  weight: number | string | null
  categories: { name: string }[] | null
  variants:
    | {
        id: string
        title: string | null
        weight: number | string | null
        options: { value: string; option: { title: string } | null }[] | null
      }[]
    | null
}

type Ligne = {
  produitId: string
  produit: string
  statut: string
  varianteId: string | null
  variante: string | null
  categories: string
  ancien: number | null
  nouveau: number | null
  regle: string
  detail: string
  motifs: Motif[]
}

function enGrammes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null
  const nombre = Number(valeur)
  return Number.isFinite(nombre) ? nombre : null
}

/** Les lignes d'un produit : la sienne d'abord, puis une par variante. */
function evaluer(produit: ProduitLu, inconnuesGlobales: Map<string, number>): Ligne[] {
  const categories = (produit.categories ?? []).map((c) => c.name)
  const { regles, inconnues, sansRegle } = reglesDe(categories)
  for (const nom of inconnues) {
    inconnuesGlobales.set(nom, (inconnuesGlobales.get(nom) ?? 0) + 1)
  }

  const commun = {
    produitId: produit.id,
    produit: produit.title,
    statut: produit.status === "published" ? "publié" : produit.status === "draft" ? "brouillon" : produit.status,
    categories: categories.join(" + ") || "—",
  }
  const variantes = produit.variants ?? []

  if (regles.length === 0) {
    const motifs: Motif[] = ["SANS CATEGORIE"]
    const details: string[] = []
    if (categories.length === 0) details.push("aucune catégorie")
    if (sansRegle.length) details.push(`catégories sans règle : ${sansRegle.join(", ")}`)
    if (inconnues.length) {
      motifs.push("CATEGORIE INCONNUE")
      details.push(`catégories inconnues : ${inconnues.join(", ")}`)
    }
    const ligne = (varianteId: string | null, variante: string | null, ancien: number | null): Ligne => ({
      ...commun,
      varianteId,
      variante,
      ancien,
      nouveau: null,
      regle: "—",
      detail: details.join(" ; "),
      motifs,
    })
    return [
      ligne(null, null, enGrammes(produit.weight)),
      ...variantes.map((v) => ligne(v.id, v.title ?? "", enGrammes(v.weight))),
    ]
  }

  const titreProduit: Source = { texte: produit.title, origine: "titre du produit" }

  const lignesVariantes = variantes.map((variante): Ligne => {
    const candidates: Source[] = [
      { texte: (variante.options ?? []).map((o) => o.value).join(" "), origine: "option" },
      { texte: variante.title ?? "", origine: "titre de la variante" },
      titreProduit,
    ]
    const sources = candidates.filter((s) => s.texte.trim() !== "")
    const pesee = decider(regles, sources)
    return {
      ...commun,
      varianteId: variante.id,
      variante: variante.title ?? "",
      ancien: enGrammes(variante.weight),
      nouveau: pesee.poids,
      regle: pesee.regle,
      detail: pesee.detail,
      motifs: pesee.motifs,
    }
  })

  /*
    Le produit se pèse sur son propre titre. À défaut, il hérite du poids de ses variantes si
    elles s'accordent toutes ; sinon il garde sa valeur, et le rapport dit pourquoi.
  */
  let pesee = decider(regles, [titreProduit])
  if (pesee.poids === null && lignesVariantes.length > 0) {
    const poidsDesVariantes = new Set(lignesVariantes.map((l) => l.nouveau))
    if (poidsDesVariantes.size === 1 && !poidsDesVariantes.has(null)) {
      const [herite] = poidsDesVariantes
      pesee = { poids: herite!, regle: lignesVariantes[0].regle, detail: "hérité des variantes", motifs: [] }
    }
  }

  const ligneProduit: Ligne = {
    ...commun,
    varianteId: null,
    variante: null,
    ancien: enGrammes(produit.weight),
    nouveau: pesee.poids,
    regle: pesee.regle,
    detail: pesee.detail,
    motifs: pesee.motifs,
  }

  return [ligneProduit, ...lignesVariantes]
}

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
