import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import { useEffect, useState, useCallback } from "react"

type AttributeType = {
  id: string
  name: string
  preset_values: string[]
  allow_multiple: boolean
}

type AttributeValue = {
  id: string
  attribute_type_id: string
  attribute_type: AttributeType
  value: string
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

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

const ProductAttributesWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const productId = data.id

  const [attributeTypes, setAttributeTypes] = useState<AttributeType[]>([])
  const [attributes, setAttributes] = useState<AttributeValue[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedTypeId, setSelectedTypeId] = useState("")
  // Pour les types multiples : set de valeurs cochées
  const [checkedValues, setCheckedValues] = useState<Set<string>>(new Set())
  // Pour les types simples : valeur unique sélectionnée
  const [singleValue, setSingleValue] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [typesRes, attrsRes] = await Promise.all([
        apiFetch<{ attribute_types: AttributeType[] }>(`/admin/attribute-types`),
        apiFetch<{ attributes: AttributeValue[] }>(`/admin/products/${productId}/attributes`),
      ])
      setAttributeTypes(typesRes.attribute_types)
      setAttributes(attrsRes.attributes)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [productId])

  useEffect(() => { fetchData() }, [fetchData])

  const selectedType = attributeTypes.find((t) => t.id === selectedTypeId)

  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId)
    setCheckedValues(new Set())
    setSingleValue("")
  }

  const toggleCheck = (value: string) => {
    setCheckedValues((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const handleAdd = async () => {
    if (!selectedTypeId) return
    const valuesToAdd = selectedType?.allow_multiple
      ? Array.from(checkedValues)
      : singleValue ? [singleValue] : []
    if (valuesToAdd.length === 0) return

    setSaving(true)
    try {
      // Pour les types multiples on crée une entrée par valeur cochée
      await Promise.all(
        valuesToAdd.map((value) =>
          apiFetch(`/admin/products/${productId}/attributes`, {
            method: "POST",
            body: JSON.stringify({ attribute_type_id: selectedTypeId, value }),
          })
        )
      )
      setSelectedTypeId("")
      setCheckedValues(new Set())
      setSingleValue("")
      await fetchData()
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const handleDelete = async (valueId: string) => {
    try {
      await apiFetch(`/admin/products/${productId}/attributes?value_id=${valueId}`, {
        method: "DELETE",
      })
      await fetchData()
    } catch (e) {
      console.error(e)
    }
  }

  // Groupe les attributs existants par type pour l'affichage
  const grouped = attributes.reduce<Record<string, { type: AttributeType; values: AttributeValue[] }>>(
    (acc, attr) => {
      const typeId = attr.attribute_type_id
      if (!acc[typeId]) acc[typeId] = { type: attr.attribute_type, values: [] }
      acc[typeId].values.push(attr)
      return acc
    },
    {}
  )

  const canAdd = selectedType?.allow_multiple
    ? checkedValues.size > 0
    : !!singleValue

  if (loading) return <div className="p-4 text-ui-fg-subtle text-sm">Chargement...</div>

  return (
    <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl p-6 mb-4">
      <h2 className="text-ui-fg-base font-semibold text-lg mb-4">Caractéristiques</h2>

      {/* Tableau des caractéristiques existantes */}
      {Object.keys(grouped).length === 0 ? (
        <p className="text-ui-fg-subtle text-sm mb-4">Aucune caractéristique ajoutée.</p>
      ) : (
        <table className="w-full mb-4 text-sm">
          <thead>
            <tr className="text-ui-fg-subtle border-b border-ui-border-base">
              <th className="text-left pb-2 font-medium">Caractéristique</th>
              <th className="text-left pb-2 font-medium">Valeur(s)</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {Object.values(grouped).map(({ type, values }) => (
              <tr key={type.id} className="border-b border-ui-border-base last:border-0">
                <td className="py-2 text-ui-fg-base align-top">{type.name}</td>
                <td className="py-2 text-ui-fg-base">
                  {values.length > 1 ? (
                    <div className="flex flex-wrap gap-1">
                      {values.map((v) => (
                        <span
                          key={v.id}
                          className="flex items-center gap-1 bg-ui-bg-subtle border border-ui-border-base rounded px-2 py-0.5 text-xs"
                        >
                          {v.value}
                          <button
                            onClick={() => handleDelete(v.id)}
                            className="text-ui-fg-muted hover:text-ui-fg-error"
                          >✕</button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    values[0].value
                  )}
                </td>
                <td className="py-2 align-top">
                  {values.length === 1 && (
                    <button
                      onClick={() => handleDelete(values[0].id)}
                      className="text-ui-fg-subtle hover:text-ui-fg-error transition-colors"
                    >✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Formulaire d'ajout */}
      <div className="border-t border-ui-border-base pt-4">
        <p className="text-ui-fg-subtle text-xs uppercase font-medium mb-3 tracking-wide">
          Ajouter une caractéristique
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Sélection du type */}
            <select
              value={selectedTypeId}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="border border-ui-border-base rounded-md px-3 py-2 text-sm bg-ui-bg-base text-ui-fg-base"
            >
              <option value="">— Caractéristique —</option>
              {attributeTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            {/* Valeur(s) */}
            {selectedType && !selectedType.allow_multiple && (
              <select
                value={singleValue}
                onChange={(e) => setSingleValue(e.target.value)}
                className="border border-ui-border-base rounded-md px-3 py-2 text-sm bg-ui-bg-base text-ui-fg-base"
              >
                <option value="">— Valeur —</option>
                {selectedType.preset_values.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}

            <button
              onClick={handleAdd}
              disabled={saving || !selectedTypeId || !canAdd}
              className="bg-ui-button-inverted text-ui-fg-on-inverted rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {saving ? "..." : "+ Ajouter"}
            </button>
          </div>

          {/* Checkboxes multiples sur une ligne séparée */}
          {selectedType?.allow_multiple && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {selectedType.preset_values.map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-sm text-ui-fg-base cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedValues.has(v)}
                    onChange={() => toggleCheck(v)}
                    className="rounded border-ui-border-base"
                  />
                  {v}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProductAttributesWidget
