import { useRef, useState } from "react"
import { Trash } from "@medusajs/icons"
import { toast } from "@medusajs/ui"

async function apiUpload<T>(path: string, method: string, body?: FormData): Promise<T> {
  const res = await fetch(path, { method, credentials: "include", body })
  if (!res.ok) {
    // Les routes d'upload renvoient { message } en JSON — on l'affiche tel quel s'il est présent.
    const raw = await res.text()
    const message = (() => {
      try { return JSON.parse(raw)?.message ?? raw } catch { return raw }
    })()
    throw new Error(message || "Une erreur est survenue")
  }
  return res.json()
}

export const uploadValueImage = (typeId: string, value: string, file: File) => {
  const formData = new FormData()
  formData.append("file", file)
  return apiUpload(`/admin/attribute-types/${typeId}/values/${encodeURIComponent(value)}/image`, "POST", formData)
}

export const deleteValueImage = (typeId: string, value: string) =>
  apiUpload(`/admin/attribute-types/${typeId}/values/${encodeURIComponent(value)}/image`, "DELETE")

// Badge d'une valeur prédéfinie : vignette logo si une image existe, sinon texte + bouton d'ajout.
// L'upload/suppression d'image n'est proposé que si allowImage est vrai (réservé au type "Marque")
// ET pour un type déjà persisté (typeId défini) — on ne peut pas attacher une image à une valeur
// qui n'existe pas encore en base.
export const PresetValueBadge = ({
  value,
  imageUrl,
  typeId,
  allowImage = false,
  onRemoveValue,
  onImageChange,
  readOnly = false,
}: {
  value: string
  imageUrl?: string
  typeId?: string
  allowImage?: boolean
  onRemoveValue?: () => void
  onImageChange?: () => void
  readOnly?: boolean
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const canUploadImage = allowImage && !!typeId

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !canUploadImage || !typeId) return
    setUploading(true)
    try {
      await uploadValueImage(typeId, value, file)
      onImageChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'upload de l'image")
    }
    setUploading(false)
  }

  const handleRemoveImage = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!canUploadImage || !typeId) return
    setUploading(true)
    try {
      await deleteValueImage(typeId, value)
      onImageChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la suppression de l'image")
    }
    setUploading(false)
  }

  if (imageUrl && allowImage) {
    return (
      <span
        className="relative flex items-center gap-1.5 bg-ui-bg-subtle border border-ui-border-base rounded px-2 py-0.5 text-xs text-ui-fg-base cursor-pointer"
        onClick={() => canUploadImage && fileInputRef.current?.click()}
        title={canUploadImage ? "Cliquer pour remplacer le logo" : value}
      >
        <img src={imageUrl} alt={value} className="h-5 w-5 object-contain rounded-sm bg-white" />
        {value}
        {canUploadImage && (
          <>
            <button
              type="button"
              onClick={handleRemoveImage}
              disabled={uploading}
              className="text-ui-fg-muted hover:text-ui-fg-error leading-none disabled:opacity-50"
            >
              ✕
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} className="hidden" />
          </>
        )}
        {!canUploadImage && !readOnly && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemoveValue?.() }}
            className="text-ui-fg-muted hover:text-ui-fg-error leading-none"
          >
            ✕
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 bg-ui-bg-subtle border border-ui-border-base rounded px-2 py-0.5 text-xs text-ui-fg-base">
      {value}
      {canUploadImage && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-ui-fg-muted hover:text-ui-fg-interactive leading-none disabled:opacity-50"
            title="Ajouter un logo"
          >
            {uploading ? "…" : "🖼"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} className="hidden" />
        </>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={onRemoveValue}
          className="text-ui-fg-muted hover:text-ui-fg-error leading-none"
        >
          ✕
        </button>
      )}
    </span>
  )
}

// Cellule dédiée à la gestion du logo, pensée pour une colonne de tableau séparée (ex: page
// "Marques") plutôt que pour un badge compact texte+image collés. Vignette plus grande, boutons
// d'action explicitement libellés ("Remplacer"/"Ajouter un logo", "Supprimer l'image").
export const BrandLogoCell = ({
  value,
  imageUrl,
  typeId,
  onImageChange,
}: {
  value: string
  imageUrl?: string
  typeId: string
  onImageChange?: () => void
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setUploading(true)
    try {
      await uploadValueImage(typeId, value, file)
      onImageChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'upload de l'image")
    }
    setUploading(false)
  }

  const handleRemoveImage = async () => {
    setUploading(true)
    try {
      await deleteValueImage(typeId, value)
      onImageChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la suppression de l'image")
    }
    setUploading(false)
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-ui-border-base bg-white">
        {imageUrl ? (
          <img src={imageUrl} alt={value} className="h-full w-full object-contain rounded-md" />
        ) : (
          <span className="text-ui-fg-muted text-xs">—</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-ui-fg-interactive text-xs font-medium hover:underline disabled:opacity-50"
        >
          {uploading ? "..." : imageUrl ? "Remplacer" : "Ajouter un logo"}
        </button>
        {imageUrl && (
          <button
            type="button"
            onClick={handleRemoveImage}
            disabled={uploading}
            title="Supprimer l'image"
            className="text-ui-fg-error hover:opacity-70 disabled:opacity-50"
          >
            <Trash />
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} className="hidden" />
      </div>
    </div>
  )
}
