import { useEffect, useState } from "react"

/*
  La carte « Stock » de la page Hiboutik : lancer la synchronisation à la main — en simulation
  ou pour de vrai —, et lire le dernier rapport, quel que soit son déclencheur (tâche
  planifiée, bouton, ligne de commande). Les types sont recopiés du serveur : l'administration
  ne peut pas importer son code.
*/

type Ecart = {
  sku: string
  titre: string
  inventory_item_id: string
  action: "creer" | "mettre_a_jour" | "inchange"
  hiboutik: number
  reserve: number
  avant: number | null
  apres: number
}

type CommandeNonReportee = {
  id: string
  display_id: number
  created_at: string
  status: string
  type: "commande" | "annulation"
  statut_hiboutik: string | null
}

export type RapportStock = {
  lus: number
  apparies: number
  sans_sku: number
  non_geres: number
  sans_article: number
  inconnus_hiboutik: number
  negatifs_hiboutik: number
  doublons_hiboutik: number
  conflits: number
  crees: number
  mis_a_jour: number
  inchanges: number
  simulation: boolean
  declencheur: "job" | "admin" | "cli"
  debut: string
  duree_ms: number
  location_id: string | null
  ecarts: Ecart[]
  ecarts_total: number
  inconnus: string[]
  negatifs: string[]
  commandes_non_reportees: CommandeNonReportee[]
  remontee_desactivee: boolean
  erreurs: string[]
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const DECLENCHEURS: Record<RapportStock["declencheur"], string> = {
  job: "tâche planifiée",
  admin: "bouton",
  cli: "ligne de commande",
}

const ACTIONS: Record<Ecart["action"], string> = {
  creer: "créé",
  mettre_a_jour: "mis à jour",
  inchange: "inchangé",
}

function dateCourte(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
}

export const HiboutikStockCard = () => {
  const [rapport, setRapport] = useState<RapportStock | null>(null)
  const [enCours, setEnCours] = useState<"simulation" | "synchronisation" | null>(null)
  const [reportEnCours, setReportEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ rapport: RapportStock | null }>("/admin/hiboutik/stock/last")
      .then((d) => setRapport(d.rapport))
      .catch(() => {})
  }, [])

  const lancer = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm("Recopier le stock Hiboutik dans Medusa ? Les niveaux de stock du site seront modifiés.")) {
      return
    }
    setEnCours(dryRun ? "simulation" : "synchronisation")
    setErreur(null)
    try {
      const d = await apiFetch<{ rapport: RapportStock }>("/admin/hiboutik/stock/sync", {
        method: "POST",
        body: JSON.stringify({ dryRun }),
      })
      setRapport(d.rapport)
    } catch (e: any) {
      setErreur(e.message || "Erreur lors de la synchronisation")
    }
    setEnCours(null)
  }

  const reporter = async (commande: CommandeNonReportee) => {
    setReportEnCours(commande.id)
    setErreur(null)
    try {
      await apiFetch("/admin/hiboutik/ventes/pousser", {
        method: "POST",
        body: JSON.stringify({ order_id: commande.id, type: commande.type }),
      })
      setRapport((r) =>
        r ? { ...r, commandes_non_reportees: r.commandes_non_reportees.filter((c) => c.id !== commande.id) } : r
      )
    } catch (e: any) {
      setErreur(e.message || "Erreur lors du report")
    }
    setReportEnCours(null)
  }

  const ecartsVisibles = rapport?.ecarts.filter((e) => e.action !== "inchange") ?? []

  return (
    <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl p-6 m-6">
      <h1 className="text-ui-fg-base font-semibold text-lg mb-2">Stock</h1>
      <p className="text-ui-fg-subtle text-sm mb-4">
        Recopie le stock de la caisse Hiboutik dans Medusa, variante par variante, en rapprochant le
        SKU du code-barres. Une tâche le fait toutes les dix minutes ; ce bouton sert à ne pas attendre.
        Les produits et variantes ne sont jamais modifiés.
      </p>

      <div className="flex gap-2 items-center">
        <button
          onClick={() => lancer(true)}
          disabled={enCours !== null}
          className="text-ui-fg-base border border-ui-border-base rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {enCours === "simulation" ? "Simulation en cours..." : "Simuler"}
        </button>
        <button
          onClick={() => lancer(false)}
          disabled={enCours !== null}
          className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          {enCours === "synchronisation" ? "Synchronisation en cours..." : "Synchroniser le stock"}
        </button>
      </div>

      {erreur && <div className="mt-4 text-ui-fg-error text-sm">{erreur}</div>}

      {rapport && (
        <div className="mt-4">
          <p className="text-ui-fg-subtle text-sm mb-2">
            Dernier passage : {dateCourte(rapport.debut)} — {DECLENCHEURS[rapport.declencheur] ?? rapport.declencheur}
            {rapport.simulation ? " (simulation, rien d'écrit)" : ""} — {rapport.duree_ms} ms
          </p>

          <table className="w-full text-sm mb-4">
            <tbody>
              {[
                ["Lignes de stock lues chez Hiboutik", rapport.lus],
                ["Variantes appariées (SKU = code-barres)", rapport.apparies],
                ["Niveaux créés", rapport.crees],
                ["Niveaux mis à jour", rapport.mis_a_jour],
                ["Niveaux inchangés", rapport.inchanges],
                ["SKU Medusa inconnus d'Hiboutik", rapport.inconnus_hiboutik],
                ["Variantes sans SKU", rapport.sans_sku],
                ["Stocks caisse négatifs (ramenés à 0)", rapport.negatifs_hiboutik],
                ["Conflits", rapport.conflits],
              ].map(([libelle, valeur]) => (
                <tr key={String(libelle)} className="border-b border-ui-border-base last:border-0">
                  <td className="py-2 text-ui-fg-subtle">{libelle}</td>
                  <td className="py-2 text-ui-fg-base font-medium">{valeur}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rapport.erreurs.length > 0 && (
            <ul className="list-disc pl-4 mb-4 text-sm text-ui-fg-error">
              {rapport.erreurs.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {ecartsVisibles.length > 0 && (
            <div className="max-h-96 overflow-y-auto border border-ui-border-base rounded-md mb-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-ui-bg-base">
                  <tr className="text-ui-fg-subtle border-b border-ui-border-base">
                    <th className="text-left p-2 font-medium">SKU</th>
                    <th className="text-left p-2 font-medium">Produit</th>
                    <th className="text-right p-2 font-medium">Caisse</th>
                    <th className="text-right p-2 font-medium">Réservé</th>
                    <th className="text-right p-2 font-medium">Avant</th>
                    <th className="text-right p-2 font-medium">Après</th>
                    <th className="text-left p-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ecartsVisibles.map((e) => (
                    <tr key={`${e.inventory_item_id}-${e.sku}`} className="border-b border-ui-border-base last:border-0">
                      <td className="p-2 text-ui-fg-subtle font-mono text-xs">{e.sku}</td>
                      <td className="p-2 text-ui-fg-base">{e.titre}</td>
                      <td className="p-2 text-right text-ui-fg-base">{e.hiboutik}</td>
                      <td className="p-2 text-right text-ui-fg-subtle">{e.reserve}</td>
                      <td className="p-2 text-right text-ui-fg-subtle">{e.avant ?? "—"}</td>
                      <td className="p-2 text-right text-ui-fg-base font-medium">{e.apres}</td>
                      <td className="p-2 text-ui-fg-subtle">{ACTIONS[e.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rapport.ecarts_total > rapport.ecarts.length && (
                <p className="p-2 text-xs text-ui-fg-subtle">
                  {rapport.ecarts.length} écarts affichés sur {rapport.ecarts_total}.
                </p>
              )}
            </div>
          )}

          {rapport.inconnus.length > 0 && (
            <p className="text-sm text-ui-fg-subtle mb-4">
              <span className="font-medium text-ui-fg-base">SKU inconnus d'Hiboutik :</span>{" "}
              {rapport.inconnus.join(", ")}
            </p>
          )}

          {rapport.remontee_desactivee ? (
            <p className="text-sm text-ui-fg-subtle">
              La remontée des ventes web vers la caisse est désactivée : les commandes ne sont pas vérifiées.
            </p>
          ) : rapport.commandes_non_reportees.length > 0 ? (
            <div>
              <h2 className="text-ui-fg-base font-medium text-sm mb-2">
                Commandes web sans vente en caisse ({rapport.commandes_non_reportees.length})
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {rapport.commandes_non_reportees.map((c) => (
                    <tr key={c.id} className="border-b border-ui-border-base last:border-0">
                      <td className="py-2 text-ui-fg-base font-medium">#{c.display_id}</td>
                      <td className="py-2 text-ui-fg-subtle">{c.type === "annulation" ? "annulation" : "commande"}</td>
                      <td className="py-2 text-ui-fg-subtle">{dateCourte(c.created_at)}</td>
                      <td className="py-2 text-ui-fg-subtle">{c.statut_hiboutik ?? "jamais tentée"}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => reporter(c)}
                          disabled={reportEnCours !== null}
                          className="text-ui-fg-base border border-ui-border-base rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          {reportEnCours === c.id ? "Report..." : "Reporter en caisse"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ui-fg-subtle">Toutes les commandes récentes ont leur vente en caisse.</p>
          )}
        </div>
      )}
    </div>
  )
}
