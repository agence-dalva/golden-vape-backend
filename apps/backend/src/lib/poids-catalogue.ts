/*
  Grille de poids du catalogue, en grammes, emballage compris.

  Partagée entre le script `appliquer-poids-catalogue`, qui repasse tout le catalogue, et le
  subscriber `produit-expediable`, qui pèse chaque produit créé ou modifié. Une seule grille :
  un poids ne doit pas dépendre du chemin par lequel le produit est entré.
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

/**
 * Une base est plus dense qu'un liquide fini (glycérine ≈ 1,26), et vendue en grand format. Les
 * 500 ml et 1 litre prolongent la grille du marchand : le liquide au prorata, plus un flacon.
 */
const GRILLE_BASE: Grille = { 120: 185, 250: 350, 500: 680, 1000: 1300 }

/** Un flacon vide ne pèse que son plastique. */
const GRILLE_FLACON: Grille = { 75: 20, 120: 30, 200: 35, 230: 40, 250: 40 }

type Regle =
  /** `defaut` : contenance supposée quand aucune n'est lisible, fixe ou selon le titre. */
  | { type: "contenance"; libelle: string; grille: Grille; defaut?: number | ((titre: string) => number) }
  | { type: "forfait"; libelle: string; grammes: number }
  /** CBD : un liquide s'il a une contenance, sinon un produit vendu au gramme. */
  | { type: "cbd"; libelle: string }

/**
 * Sans contenance lisible, un liquide est supposé au format le plus vendu — 50 ml, ou 30 ml pour
 * un concentré. Sur-estimer un 10 ml coûte une tranche ; le sous-estimer, un repesage facturé.
 */
const LIQUIDE: Regle = {
  type: "contenance",
  libelle: "Liquide",
  grille: GRILLE_LIQUIDE,
  defaut: (titre) => (/concentr|ar[oô]me/i.test(titre) ? 30 : 50),
}
const BASE: Regle = { type: "contenance", libelle: "Base", grille: GRILLE_BASE }
/** Un flacon sans contenance est supposé au format médian de la grille. */
const FLACON: Regle = { type: "contenance", libelle: "Flacon", grille: GRILLE_FLACON, defaut: 120 }
/** Un booster de nicotine est un 10 ml : c'est le plus grand format que la loi lui permet. */
const BOOSTER: Regle = { type: "contenance", libelle: "Booster", grille: GRILLE_LIQUIDE, defaut: 10 }
const CBD: Regle = { type: "cbd", libelle: "CBD" }

/** Emballage d'un produit CBD vendu au gramme : pochon, étiquette, carton. */
const EMBALLAGE_CBD_GRAMMES = 15
/** Un pré-roll dans son tube ; et le reste du CBD sans grammage, plus lourd par prudence. */
const FORFAIT_PRE_ROLL = 20
const FORFAIT_CBD_SANS_GRAMMAGE = 50

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
  cbd: CBD,
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
 * « 10.5ml » ; la fin écarte « 30lm » et autres coquilles.
 */
const CONTENANCE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*ml(?!\p{L})/giu
/** « 1 litre », « 1L », « 0,5 l » — les bases, converties en millilitres. */
const LITRES = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:l|litres?)(?!\p{L})/giu
/** Un grammage : « 7g », « 2.5G », « 10 g » — le CBD vendu au poids. « mg » n'en est pas un. */
const GRAMMES = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*g(?!\p{L})/giu


/** Les quatre premiers empêchent l'écriture ; les deux derniers l'accompagnent d'un avertissement. */
export type Motif =
  | "SANS CATEGORIE"
  | "CATEGORIE INCONNUE"
  | "SANS CONTENANCE"
  | "HORS GRILLE"
  | "DEDUIT"
  | "CONFLIT"

export const ORDRE_DES_MOTIFS: Motif[] = [
  "SANS CATEGORIE",
  "CATEGORIE INCONNUE",
  "SANS CONTENANCE",
  "HORS GRILLE",
  "DEDUIT",
  "CONFLIT",
]

export const MOTIFS_ECRITS: Record<Motif, string | null> = {
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
  /** Poids de repli — contenance supposée, forfait faute de mieux : cède devant toute lecture directe. */
  repli?: boolean
}

export function replier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Les contenances distinctes d'un texte, en millilitres, dans l'ordre où elles apparaissent. */
export function contenances(texte: string): number[] {
  const valeurs = [
    ...[...texte.matchAll(CONTENANCE)].map((m) => Number(m[1].replace(",", "."))),
    ...[...texte.matchAll(LITRES)].map((m) => Number(m[1].replace(",", ".")) * 1000),
  ]
  return [...new Set(valeurs)]
}

/** Le premier grammage lisible parmi les sources, et d'où il vient. */
export function grammesDe(sources: Source[]): { valeur: number; origine: Origine } | null {
  for (const source of sources) {
    const m = [...source.texte.matchAll(GRAMMES)][0]
    if (m) return { valeur: Number(m[1].replace(",", ".")), origine: source.origine }
  }
  return null
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

/**
 * Le CBD se pèse comme un liquide s'il en est un ; sinon au grammage du titre, emballage compris,
 * arrondi aux 5 g au-dessus ; sinon au forfait — léger pour un pré-roll, prudent pour le reste.
 */
function peserCbd(sources: Source[]): Pesee {
  if (contenanceDe(sources).valeur !== null) {
    return peser(LIQUIDE, sources)
  }
  const grammage = grammesDe(sources)
  if (grammage) {
    const poids = Math.ceil((grammage.valeur + EMBALLAGE_CBD_GRAMMES) / 5) * 5
    return {
      poids,
      regle: "CBD au gramme",
      detail: `${grammage.valeur} g (${grammage.origine}) + ${EMBALLAGE_CBD_GRAMMES} g d'emballage`,
      motifs: ["DEDUIT"],
    }
  }
  const preRoll = sources.some((s) => /pr[ée][ -]?rolls?/i.test(s.texte))
  return {
    poids: preRoll ? FORFAIT_PRE_ROLL : FORFAIT_CBD_SANS_GRAMMAGE,
    regle: preRoll ? "CBD pré-roll" : "CBD sans grammage",
    detail: preRoll ? "pré-roll, forfait" : "ni contenance ni grammage lisibles, forfait prudent",
    motifs: ["DEDUIT"],
    repli: true,
  }
}

function peser(regle: Regle, sources: Source[]): Pesee {
  if (regle.type === "forfait") {
    return { poids: regle.grammes, regle: regle.libelle, detail: "forfait de la catégorie", motifs: [] }
  }
  if (regle.type === "cbd") {
    return peserCbd(sources)
  }

  let contenance = contenanceDe(sources)
  let repli = false
  if (contenance.valeur === null && regle.defaut !== undefined) {
    const titre = sources[sources.length - 1]?.texte ?? ""
    const defaut = typeof regle.defaut === "function" ? regle.defaut(titre) : regle.defaut
    contenance = {
      valeur: defaut,
      origine: "titre du produit",
      deduite: `${defaut} ml supposés, aucune contenance lisible`,
    }
    repli = true
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
    ...(repli ? { repli } : {}),
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
  const toutes = pesees.filter((p) => p.poids !== null)
  // Un poids de repli ne se mesure pas à une lecture directe : il ne sert qu'en l'absence de toute autre.
  const directes = toutes.filter((p) => !p.repli)
  const abouties = directes.length > 0 ? directes : toutes

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

export type ProduitLu = {
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

export type Ligne = {
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

export function enGrammes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null
  const nombre = Number(valeur)
  return Number.isFinite(nombre) ? nombre : null
}

/** Les lignes d'un produit : la sienne d'abord, puis une par variante. */
export function evaluer(produit: ProduitLu, inconnuesGlobales: Map<string, number>): Ligne[] {
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
    Le produit se pèse sur son propre titre. À défaut — ou si son titre n'a livré qu'un poids de
    repli — il hérite du poids de ses variantes si elles s'accordent toutes ; sinon il garde sa
    valeur, et le rapport dit pourquoi.
  */
  let pesee = decider(regles, [titreProduit])
  if ((pesee.poids === null || pesee.repli) && lignesVariantes.length > 0) {
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

/**
 * Les poids à poser sur un produit qui n'en a pas, sans jamais toucher à un poids déjà saisi.
 *
 * C'est la règle « conserver » du script, appliquée à un seul produit : une valeur entrée à la
 * main par le marchand fait foi, même si la grille dirait autre chose. Ce qui ne se pèse pas —
 * pas de catégorie, contenance hors grille — reste vide plutôt que d'être deviné.
 */
export function poidsManquants(produit: ProduitLu): {
  produit: number | null
  variantes: { id: string; poids: number }[]
} {
  const lignes = evaluer(produit, new Map())
  const manque = (l: Ligne) => l.nouveau !== null && !(l.ancien !== null && l.ancien > 0)

  const ligneProduit = lignes.find((l) => l.varianteId === null)

  return {
    produit: ligneProduit && manque(ligneProduit) ? ligneProduit.nouveau : null,
    variantes: lignes
      .filter((l) => l.varianteId !== null && manque(l))
      .map((l) => ({ id: l.varianteId!, poids: l.nouveau! })),
  }
}
