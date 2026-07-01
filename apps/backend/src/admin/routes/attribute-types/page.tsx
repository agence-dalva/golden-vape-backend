import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useCallback, useRef, KeyboardEvent } from "react"

type AttributeType = {
  id: string
  name: string
  preset_values: string[]
  allow_multiple: boolean
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
  label: "Caractéristiques",
})

// Composant input de tags : une valeur par entrée, supprimable avec ✕
const TagInput = ({
  values,
  onChange,
}: {
  values: string[]
  onChange: (v: string[]) => void
}) => {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const addValue = () => {
    const trimmed = input.trim()
    if (!trimmed || values.includes(trimmed)) { setInput(""); return }
    onChange([...values, trimmed])
    setInput("")
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addValue() }
    if (e.key === "Backspace" && !input && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 border border-ui-border-base rounded-md px-3 py-2 bg-ui-bg-base cursor-text min-h-[42px]"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1 bg-ui-bg-subtle border border-ui-border-base rounded px-2 py-0.5 text-xs text-ui-fg-base"
        >
          {v}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(values.filter((x) => x !== v)) }}
            className="text-ui-fg-muted hover:text-ui-fg-error leading-none"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={addValue}
        placeholder={values.length === 0 ? "Taper une valeur puis Entrée…" : ""}
        className="flex-1 min-w-[140px] text-sm bg-transparent text-ui-fg-base outline-none placeholder:text-ui-fg-muted"
      />
    </div>
  )
}

const AttributeTypesPage = () => {
  const [types, setTypes] = useState<AttributeType[]>([])
  const [loading, setLoading] = useState(true)

  const [newName, setNewName] = useState("")
  const [newPresets, setNewPresets] = useState<string[]>([])
  const [newAllowMultiple, setNewAllowMultiple] = useState(false)
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editPresets, setEditPresets] = useState<string[]>([])
  const [editAllowMultiple, setEditAllowMultiple] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchTypes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch<{ attribute_types: AttributeType[] }>("/admin/attribute-types")
      setTypes(res.attribute_types)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTypes() }, [fetchTypes])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await apiFetch("/admin/attribute-types", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), preset_values: newPresets, allow_multiple: newAllowMultiple }),
      })
      setNewName("")
      setNewPresets([])
      setNewAllowMultiple(false)
      await fetchTypes()
    } catch (e) {
      console.error(e)
    }
    setCreating(false)
  }

  const startEdit = (t: AttributeType) => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditPresets([...t.preset_values])
    setEditAllowMultiple(t.allow_multiple)
  }

  const handleSave = async (id: string) => {
    setSaving(true)
    try {
      await apiFetch(`/admin/attribute-types/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name: editName.trim(), preset_values: editPresets, allow_multiple: editAllowMultiple }),
      })
      setEditingId(null)
      await fetchTypes()
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce type de caractéristique ?")) return
    try {
      await apiFetch(`/admin/attribute-types/${id}`, { method: "DELETE" })
      await fetchTypes()
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-ui-fg-base text-2xl font-semibold">Caractéristiques produit</h1>
        <p className="text-ui-fg-subtle text-sm mt-1">
          Définissez les types de caractéristiques et leurs valeurs prédéfinies.
        </p>
      </div>

      {/* Formulaire de création */}
      <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl p-6 mb-6">
        <h2 className="text-ui-fg-base font-semibold mb-4">Nouveau type de caractéristique</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-ui-fg-subtle text-sm font-medium">Nom</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Ex: Taux de nicotine"
              className="border border-ui-border-base rounded-md px-3 py-2 text-sm bg-ui-bg-base text-ui-fg-base max-w-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-ui-fg-subtle text-sm font-medium">Valeurs prédéfinies</label>
            <div className="max-w-lg">
              <TagInput values={newPresets} onChange={setNewPresets} />
            </div>
            <p className="text-ui-fg-muted text-xs">
              Appuyer sur Entrée pour valider chaque valeur. Laisser vide pour saisie libre uniquement.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newAllowMultiple}
              onChange={(e) => setNewAllowMultiple(e.target.checked)}
              className="rounded border-ui-border-base"
            />
            <span className="text-sm text-ui-fg-base">Sélection multiple</span>
            <span className="text-xs text-ui-fg-muted">(plusieurs valeurs possibles par produit)</span>
          </label>
          <div>
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {creating ? "Création..." : "+ Créer"}
            </button>
          </div>
        </div>
      </div>

      {/* Liste des types existants */}
      <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl overflow-hidden">
        <div className="p-4 border-b border-ui-border-base">
          <h2 className="text-ui-fg-base font-semibold">Types existants ({types.length})</h2>
        </div>

        {loading ? (
          <div className="p-6 text-ui-fg-subtle text-sm">Chargement...</div>
        ) : types.length === 0 ? (
          <div className="p-6 text-ui-fg-subtle text-sm">Aucun type créé.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium w-48">Nom</th>
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium">Valeurs prédéfinies</th>
                <th className="text-left px-4 py-3 text-ui-fg-subtle font-medium w-32">Multiple</th>
                <th className="w-28 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-ui-border-base last:border-0">
                  {editingId === t.id ? (
                    <>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="border border-ui-border-base rounded-md px-2 py-1 text-sm bg-ui-bg-base text-ui-fg-base w-full"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <TagInput values={editPresets} onChange={setEditPresets} />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={editAllowMultiple}
                          onChange={(e) => setEditAllowMultiple(e.target.checked)}
                          className="rounded border-ui-border-base"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleSave(t.id)}
                            disabled={saving}
                            className="text-ui-fg-interactive text-xs font-medium hover:underline disabled:opacity-50"
                          >
                            {saving ? "..." : "Sauver"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-ui-fg-subtle text-xs hover:underline"
                          >
                            Annuler
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-ui-fg-base font-medium">{t.name}</td>
                      <td className="px-4 py-3">
                        {t.preset_values.length === 0 ? (
                          <span className="text-ui-fg-muted italic">Saisie libre</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {t.preset_values.map((v) => (
                              <span
                                key={v}
                                className="bg-ui-bg-subtle border border-ui-border-base rounded px-2 py-0.5 text-xs text-ui-fg-base"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.allow_multiple ? (
                          <span className="text-xs text-ui-fg-interactive font-medium">Oui</span>
                        ) : (
                          <span className="text-xs text-ui-fg-muted">Non</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3 justify-end">
                          <button
                            onClick={() => startEdit(t)}
                            className="text-ui-fg-interactive text-xs font-medium hover:underline"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="text-ui-fg-error text-xs font-medium hover:underline"
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default AttributeTypesPage
