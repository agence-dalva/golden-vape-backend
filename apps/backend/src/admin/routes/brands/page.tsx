import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Tag } from "@medusajs/icons"
import { useEffect, useState, useCallback } from "react"
import { BrandLogoCell } from "../../components/preset-value-badge"

type AttributeType = {
  id: string
  name: string
  preset_values: string[]
  allow_multiple: boolean
  preset_value_images: Record<string, string>
  preset_value_counts: Record<string, number>
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
  label: "Marques",
  icon: Tag,
})

const BrandsPage = () => {
  const [marqueType, setMarqueType] = useState<AttributeType | null>(null)
  const [loading, setLoading] = useState(true)
  const [newBrandName, setNewBrandName] = useState("")
  const [adding, setAdding] = useState(false)

  const fetchMarqueType = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch<{ attribute_types: AttributeType[] }>("/admin/attribute-types")
      setMarqueType(res.attribute_types.find((t) => t.name === "Marque") ?? null)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMarqueType() }, [fetchMarqueType])

  const handleAddBrand = async () => {
    const trimmed = newBrandName.trim()
    if (!trimmed || !marqueType || marqueType.preset_values.includes(trimmed)) {
      setNewBrandName("")
      return
    }
    setAdding(true)
    try {
      await apiFetch(`/admin/attribute-types/${marqueType.id}`, {
        method: "PUT",
        body: JSON.stringify({ preset_values: [...marqueType.preset_values, trimmed] }),
      })
      setNewBrandName("")
      await fetchMarqueType()
    } catch (e) {
      console.error(e)
    }
    setAdding(false)
  }

  const handleRemoveBrand = async (value: string) => {
    if (!marqueType) return
    if (!confirm(`Supprimer la marque "${value}" ? Les produits déjà tagués avec cette valeur ne seront pas modifiés.`)) return
    try {
      await apiFetch(`/admin/attribute-types/${marqueType.id}`, {
        method: "PUT",
        body: JSON.stringify({ preset_values: marqueType.preset_values.filter((v) => v !== value) }),
      })
      await fetchMarqueType()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-ui-fg-base text-2xl font-semibold">Marques</h1>
        <p className="text-ui-fg-subtle text-sm mt-1">
          Gérez le logo de chaque marque — affiché dans le menu "Nos marques" du site.
        </p>
      </div>

      <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl p-6 mb-6">
        <h2 className="text-ui-fg-base font-semibold mb-4">Ajouter une marque</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddBrand()}
            placeholder="Ex: Vaporesso"
            className="border border-ui-border-base rounded-md px-3 py-2 text-sm bg-ui-bg-base text-ui-fg-base max-w-sm"
          />
          <button
            onClick={handleAddBrand}
            disabled={adding || !newBrandName.trim() || !marqueType}
            className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {adding ? "Ajout..." : "+ Ajouter"}
          </button>
        </div>
      </div>

      <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl overflow-hidden">
        <div className="p-4 border-b border-ui-border-base">
          <h2 className="text-ui-fg-base font-semibold">
            Marques {marqueType ? `(${marqueType.preset_values.length})` : ""}
          </h2>
        </div>

        {loading ? (
          <div className="p-6 text-ui-fg-subtle text-sm">Chargement...</div>
        ) : !marqueType || marqueType.preset_values.length === 0 ? (
          <div className="p-6 text-ui-fg-subtle text-sm">Aucune marque créée.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium w-64">Logo</th>
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium">Marque</th>
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium w-32">Produits</th>
                <th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {marqueType.preset_values.map((value) => (
                <tr key={value} className="border-b border-ui-border-base last:border-0">
                  <td className="px-4 py-3">
                    <BrandLogoCell
                      value={value}
                      imageUrl={marqueType.preset_value_images?.[value]}
                      typeId={marqueType.id}
                      onImageChange={fetchMarqueType}
                    />
                  </td>
                  <td className="px-4 py-3 text-ui-fg-base font-medium">{value}</td>
                  <td className="px-4 py-3 text-ui-fg-subtle">
                    {marqueType.preset_value_counts?.[value] ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRemoveBrand(value)}
                      className="text-ui-fg-error text-xs font-medium hover:underline"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default BrandsPage
