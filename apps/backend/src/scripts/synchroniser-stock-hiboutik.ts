import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { writeFileSync } from "node:fs"
import { lancerSynchronisationStock } from "../modules/hiboutik/lib/stock-sync-runner"

/*
  Recopie le stock de la caisse Hiboutik dans Medusa — la même synchronisation que la tâche
  planifiée et le bouton de l'administration, lancée à la main, avec un rapport complet.

  Simulation par défaut : rien n'est écrit tant que `appliquer` n'est pas passé. Le rapport
  montre, niveau par niveau, la valeur en caisse, le réservé, l'ancien et le nouveau stock.

    npx medusa exec ./src/scripts/synchroniser-stock-hiboutik.ts
    npx medusa exec ./src/scripts/synchroniser-stock-hiboutik.ts csv=/tmp/stock.csv
    npx medusa exec ./src/scripts/synchroniser-stock-hiboutik.ts appliquer
    npx medusa exec ./src/scripts/synchroniser-stock-hiboutik.ts appliquer jours=14

  `csv=chemin` écrit tous les écarts dans un fichier ; sa colonne « avant » est la trace pour
  revenir en arrière. `jours=N` fixe la fenêtre des commandes dont on vérifie la remontée en
  caisse (7 par défaut). Les arguments s'écrivent sans tirets : `medusa exec` garde pour lui
  tout ce qui commence par `--`.

  La base visée est annoncée en tête : la CLI charge `.env` avant `medusa-config`, seul un
  DATABASE_URL passé dans le shell l'emporte. Lire cette ligne avant d'appliquer.
*/

function baseVisee(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "")
    return `${url.hostname}${url.pathname}`
  } catch {
    return "DATABASE_URL illisible"
  }
}

function tronquer(texte: string, largeur: number): string {
  return texte.length > largeur ? `${texte.slice(0, largeur - 1)}…` : texte.padEnd(largeur)
}

function champCsv(valeur: string | number | null): string {
  const texte = valeur === null ? "" : String(valeur)
  return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte
}

export default async function synchroniserStockHiboutik({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const options = new Map(
    (args ?? []).map((argument) => {
      const nu = argument.replace(/^--/, "")
      const separateur = nu.indexOf("=")
      return separateur === -1 ? [nu, ""] : [nu.slice(0, separateur), nu.slice(separateur + 1)]
    })
  )
  const appliquer = options.has("appliquer")
  const cheminCsv = options.get("csv") || null
  const jours = Number(options.get("jours")) || 7

  logger.info("")
  logger.info(`  Base : ${baseVisee()}`)

  const rapport = await lancerSynchronisationStock(container, {
    dryRun: !appliquer,
    declencheur: "cli",
    joursReconciliation: jours,
  })

  logger.info(
    `  Hiboutik : ${rapport.lus} lignes de stock lues` +
      (rapport.doublons_hiboutik ? `, ${rapport.doublons_hiboutik} code(s)-barres en doublon` : "") +
      ` — entrepôt Medusa : ${rapport.location_id ?? "aucun"}`
  )
  logger.info(
    `  Variantes : ${rapport.apparies} appariées, ${rapport.sans_sku} sans SKU, ${rapport.non_geres} sans gestion de stock, ` +
      `${rapport.sans_article} sans article d'inventaire, ${rapport.inconnus_hiboutik} SKU inconnus d'Hiboutik, ` +
      `${rapport.negatifs_hiboutik} stock(s) caisse négatif(s), ${rapport.conflits} conflit(s).`
  )

  const aMontrer = rapport.ecarts.filter((e) => e.action !== "inchange")
  logger.info("")
  logger.info(
    `  ${tronquer("SKU", 16)} ${tronquer("Produit", 44)} ${"Caisse".padStart(7)} ${"Réservé".padStart(8)} ${"Avant".padStart(6)} ${"Après".padStart(6)}  Action`
  )
  for (const e of aMontrer.slice(0, cheminCsv ? 20 : 60)) {
    logger.info(
      `  ${tronquer(e.sku, 16)} ${tronquer(e.titre, 44)} ${String(e.hiboutik).padStart(7)} ${String(e.reserve).padStart(8)} ` +
        `${(e.avant === null ? "—" : String(e.avant)).padStart(6)} ${String(e.apres).padStart(6)}  ${e.action.replaceAll("_", " ")}`
    )
  }
  if (aMontrer.length > (cheminCsv ? 20 : 60)) {
    logger.info(`  … ${aMontrer.length - (cheminCsv ? 20 : 60)} autres écarts${cheminCsv ? " dans le CSV" : ""}.`)
  }

  logger.info("")
  logger.info(
    `  ${appliquer ? "Écrit" : "À écrire"} : ${rapport.crees} création(s), ${rapport.mis_a_jour} mise(s) à jour ; inchangés : ${rapport.inchanges}.`
  )

  if (rapport.inconnus.length) {
    logger.info("")
    logger.info(`  SKU inconnus d'Hiboutik (${rapport.inconnus.length}) : ${rapport.inconnus.slice(0, 40).join(", ")}${rapport.inconnus.length > 40 ? ", …" : ""}`)
  }
  if (rapport.negatifs.length) {
    logger.info(`  Stock caisse négatif, ramené à zéro (${rapport.negatifs.length}) : ${rapport.negatifs.join(", ")}`)
  }
  if (rapport.remontee_desactivee) {
    logger.info("  Remontée des ventes désactivée (HIBOUTIK_SALES_PUSH_ENABLED) : commandes non vérifiées.")
  } else if (rapport.commandes_non_reportees.length) {
    logger.info("")
    logger.info(`  ⚠ ${rapport.commandes_non_reportees.length} commande(s) des ${jours} derniers jours sans vente en caisse :`)
    for (const c of rapport.commandes_non_reportees) {
      logger.info(`    #${c.display_id} (${c.type}, ${c.status}, ${c.created_at.slice(0, 16)}) — statut Hiboutik : ${c.statut_hiboutik ?? "aucun"}`)
    }
  }
  for (const erreur of rapport.erreurs) {
    logger.error(`  ✗ ${erreur}`)
  }

  if (cheminCsv) {
    const colonnes = ["sku", "titre", "inventory_item_id", "hiboutik", "reserve", "avant", "apres", "action"]
    const contenu = [
      colonnes.join(";"),
      ...rapport.ecarts.map((e) =>
        [e.sku, e.titre, e.inventory_item_id, e.hiboutik, e.reserve, e.avant, e.apres, e.action].map(champCsv).join(";")
      ),
    ].join("\n")
    writeFileSync(cheminCsv, `﻿${contenu}\n`, "utf8")
    logger.info(`  Tableau complet écrit dans ${cheminCsv} (${rapport.ecarts.length} lignes).`)
  }

  logger.info("")
  logger.info(
    appliquer
      ? `  Terminé en ${rapport.duree_ms} ms.`
      : "  Simulation. Rien n'a été écrit — ajouter « appliquer » pour écrire."
  )
  logger.info("")
}
