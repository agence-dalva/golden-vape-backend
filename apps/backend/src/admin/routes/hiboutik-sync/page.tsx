import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState } from "react"

type HiboutikProduct = {
  product_id: number
  product_model: string
  product_barcode: string | null
  product_price: string | number | null
  product_size_details: { size_id: number; size_name: string; barcode: string }[] | null
  category_name: string
}

type PreviewResult = {
  total_hiboutik: number
  matched: number
  missing: HiboutikProduct[]
  cached: boolean
}

type CreateResult = {
  created: number
  errors: { product_ref: string; message: string }[]
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

export const config = defineRouteConfig({
  label: "Sync Hiboutik",
})

const HiboutikSyncPage = () => {
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePreview = async (force = false) => {
    setPreviewing(true)
    setError(null)
    setPreview(null)
    setCreateResult(null)
    try {
      const data = await apiFetch<PreviewResult>(
        `/admin/hiboutik/sync/preview${force ? "?force=true" : ""}`,
        { method: "POST" }
      )
      setPreview(data)
      setSelected(new Set(data.missing.map((p) => p.product_id)))
    } catch (e: any) {
      setError(e.message || "Erreur lors de la prévisualisation")
    }
    setPreviewing(false)
  }

  const toggleOne = (productId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const toggleAll = () => {
    if (!preview) return
    setSelected((prev) =>
      prev.size === preview.missing.length ? new Set() : new Set(preview.missing.map((p) => p.product_id))
    )
  }

  const handleCreate = async () => {
    if (!preview) return
    const toCreate = preview.missing.filter((p) => selected.has(p.product_id))
    if (toCreate.length === 0) return

    setCreating(true)
    setError(null)
    try {
      const data = await apiFetch<CreateResult>("/admin/hiboutik/sync/create", {
        method: "POST",
        body: JSON.stringify({ missing: toCreate }),
      })
      setCreateResult(data)
      setPreview(null)
    } catch (e: any) {
      setError(e.message || "Erreur lors de la création")
    }
    setCreating(false)
  }

  return (
    <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl p-6 m-6">
      <h1 className="text-ui-fg-base font-semibold text-lg mb-2">Synchronisation Hiboutik</h1>
      <p className="text-ui-fg-subtle text-sm mb-4">
        Compare les produits de l'inventaire Hiboutik aux produits Medusa existants (par nom) et permet
        d'ajouter ceux qui manquent. Aucun produit existant n'est modifié ou supprimé.
      </p>

      <div className="flex gap-2 items-center">
        <button
          onClick={() => handlePreview(false)}
          disabled={previewing || creating}
          className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          {previewing ? "Analyse en cours..." : "Prévisualiser"}
        </button>

        {preview?.cached && (
          <button
            onClick={() => handlePreview(true)}
            disabled={previewing || creating}
            className="text-ui-fg-subtle hover:text-ui-fg-base text-sm underline disabled:opacity-50"
          >
            Résultat en cache — forcer le rafraîchissement
          </button>
        )}

        {preview && preview.missing.length > 0 && (
          <button
            onClick={handleCreate}
            disabled={creating || selected.size === 0}
            className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 transition-opacity"
          >
            {creating ? "Création en cours..." : `Confirmer et créer (${selected.size} produits)`}
          </button>
        )}
      </div>

      {error && <div className="mt-4 text-ui-fg-error text-sm">{error}</div>}

      {preview && (
        <div className="mt-4">
          <table className="w-full text-sm mb-4">
            <tbody>
              <tr className="border-b border-ui-border-base">
                <td className="py-2 text-ui-fg-subtle">Produits trouvés dans Hiboutik</td>
                <td className="py-2 text-ui-fg-base font-medium">{preview.total_hiboutik}</td>
              </tr>
              <tr className="border-b border-ui-border-base">
                <td className="py-2 text-ui-fg-subtle">Déjà présents dans Medusa (par nom)</td>
                <td className="py-2 text-ui-fg-base font-medium">{preview.matched}</td>
              </tr>
              <tr>
                <td className="py-2 text-ui-fg-subtle">Manquants</td>
                <td className="py-2 text-ui-fg-base font-medium">{preview.missing.length}</td>
              </tr>
            </tbody>
          </table>

          {preview.missing.length > 0 && (
            <div className="max-h-96 overflow-y-auto border border-ui-border-base rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-ui-bg-base">
                  <tr className="text-ui-fg-subtle border-b border-ui-border-base">
                    <th className="w-8 p-2">
                      <input
                        type="checkbox"
                        checked={selected.size === preview.missing.length}
                        onChange={toggleAll}
                        className="rounded border-ui-border-base"
                      />
                    </th>
                    <th className="text-left p-2 font-medium">Nom</th>
                    <th className="text-left p-2 font-medium">Catégorie</th>
                    <th className="text-left p-2 font-medium">Prix</th>
                    <th className="text-left p-2 font-medium">Déclinaisons</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.missing.map((p) => (
                    <tr key={p.product_id} className="border-b border-ui-border-base last:border-0">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(p.product_id)}
                          onChange={() => toggleOne(p.product_id)}
                          className="rounded border-ui-border-base"
                        />
                      </td>
                      <td className="p-2 text-ui-fg-base">{p.product_model}</td>
                      <td className="p-2 text-ui-fg-subtle">{p.category_name}</td>
                      <td className="p-2 text-ui-fg-subtle">{p.product_price ?? "—"}</td>
                      <td className="p-2 text-ui-fg-subtle">
                        {p.product_size_details?.length ? p.product_size_details.length : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {createResult && (
        <table className="w-full mt-4 text-sm">
          <tbody>
            <tr className="border-b border-ui-border-base">
              <td className="py-2 text-ui-fg-subtle">Créés</td>
              <td className="py-2 text-ui-fg-base font-medium">{createResult.created}</td>
            </tr>
            <tr>
              <td className="py-2 text-ui-fg-subtle align-top">Erreurs</td>
              <td className="py-2 text-ui-fg-base">
                {createResult.errors.length === 0 ? (
                  "Aucune"
                ) : (
                  <ul className="list-disc pl-4">
                    {createResult.errors.map((e) => (
                      <li key={e.product_ref} className="text-ui-fg-error">
                        {e.product_ref} — {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

export default HiboutikSyncPage
