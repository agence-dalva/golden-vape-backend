import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowUpTray, Photo, Trash } from "@medusajs/icons"
import { Button, Container, Heading, IconButton, Text, toast, usePrompt } from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Bannière de la page d'accueil : les images qui défilent derrière le titre.
 *
 * Une seule image : elle reste fixe. Deux ou plus : elles se succèdent en fondu. L'ordre se
 * règle en glissant les vignettes ; la première est celle qui s'affiche au chargement.
 */
export const config = defineRouteConfig({
  label: "Bannière d'accueil",
  icon: Photo,
})

type Image = { id: string; url: string; largeur: number; hauteur: number; rang: number }

async function api<T>(chemin: string, options?: RequestInit): Promise<T> {
  const res = await fetch(chemin, { credentials: "include", ...options })
  const corps = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((corps as { message?: string }).message ?? `Erreur ${res.status}`)
  return corps as T
}

const BannierePage = () => {
  const [images, setImages] = useState<Image[] | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const champFichier = useRef<HTMLInputElement>(null)
  // Glisser-déposer : la vignette tenue, et l'ordre tel qu'il était au début du geste — pour
  // n'enregistrer que si quelque chose a vraiment bougé.
  const [tenue, setTenue] = useState<number | null>(null)
  const ordreAuDepart = useRef<string[]>([])
  const confirmer = usePrompt()

  const charger = useCallback(async () => {
    try {
      const { images } = await api<{ images: Image[] }>("/admin/banniere")
      setImages(images)
    } catch (erreur) {
      toast.error((erreur as Error).message)
      setImages([])
    }
  }, [])

  useEffect(() => {
    charger()
  }, [charger])

  // Plusieurs fichiers à la fois : envoyés l'un après l'autre, pour garder l'ordre choisi et
  // dire précisément lequel est refusé.
  const ajouter = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return
    setEnvoi(true)
    for (const fichier of Array.from(fichiers)) {
      const formulaire = new FormData()
      formulaire.append("file", fichier)
      try {
        await api("/admin/banniere", { method: "POST", body: formulaire })
        toast.success(`« ${fichier.name} » ajoutée à la bannière`)
      } catch (erreur) {
        toast.error(`« ${fichier.name} » : ${(erreur as Error).message}`)
      }
    }
    if (champFichier.current) champFichier.current.value = ""
    setEnvoi(false)
    charger()
  }

  const commencerGlisser = (index: number) => {
    ordreAuDepart.current = (images ?? []).map((i) => i.id)
    setTenue(index)
  }

  // L'ordre suit la souris pendant le geste : on voit où l'image va atterrir avant de lâcher.
  const survoler = (index: number) => {
    if (tenue === null || tenue === index || !images) return
    const ordre = [...images]
    const [image] = ordre.splice(tenue, 1)
    ordre.splice(index, 0, image)
    setImages(ordre)
    setTenue(index)
  }

  const finirGlisser = async () => {
    setTenue(null)
    if (!images) return
    const ids = images.map((i) => i.id)
    if (ids.join() === ordreAuDepart.current.join()) return
    try {
      await api("/admin/banniere/ordre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      toast.success("Ordre enregistré")
    } catch (erreur) {
      toast.error((erreur as Error).message)
      charger()
    }
  }

  const supprimer = async (image: Image, position: number) => {
    const ok = await confirmer({
      title: `Retirer l'image n°${position} ?`,
      description: "Elle disparaît de la page d'accueil et son fichier est supprimé.",
      confirmText: "Retirer",
      cancelText: "Annuler",
    })
    if (!ok) return
    try {
      await api(`/admin/banniere/${image.id}`, { method: "DELETE" })
      toast.success("Image retirée de la bannière")
      charger()
    } catch (erreur) {
      toast.error((erreur as Error).message)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <Heading level="h1">Bannière d'accueil</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {images && images.length > 1
              ? `${images.length} images : elles se succèdent en fondu, toutes les 6 secondes.`
              : images?.length === 1
                ? "Une seule image : elle reste fixe. Ajoutez-en une deuxième pour lancer le fondu."
                : "Aucune image : la page d'accueil affiche son visuel par défaut."}
          </Text>
        </div>
        <div>
          <input
            ref={champFichier}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => ajouter(e.target.files)}
          />
          <Button variant="secondary" isLoading={envoi} onClick={() => champFichier.current?.click()}>
            <ArrowUpTray />
            Ajouter des images
          </Button>
        </div>
      </div>

      {images && images.length > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" className="text-ui-fg-muted mb-3">
            Glissez une vignette pour changer l'ordre.
          </Text>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {images.map((image, index) => (
              <li
                key={image.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move"
                  commencerGlisser(index)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  survoler(index)
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={finirGlisser}
                className={`group border-ui-border-base bg-ui-bg-subtle relative aspect-video cursor-grab overflow-hidden rounded-md border transition-opacity active:cursor-grabbing ${
                  tenue === index ? "opacity-40 ring-2 ring-ui-border-interactive" : ""
                }`}
              >
                <img
                  src={image.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
                <span
                  className={`absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold shadow ${
                    index === 0 ? "bg-ui-button-inverted text-ui-fg-on-inverted" : "bg-ui-bg-base text-ui-fg-base"
                  }`}
                  title={index === 0 ? "S'affiche au chargement de la page" : undefined}
                >
                  {index + 1}
                </span>
                <IconButton
                  size="small"
                  variant="primary"
                  onClick={() => supprimer(image, index + 1)}
                  aria-label={`Retirer l'image n°${index + 1}`}
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash />
                </IconButton>
                <span className="text-ui-fg-on-color absolute bottom-1 right-1.5 text-[10px] opacity-0 drop-shadow transition-opacity group-hover:opacity-100">
                  {image.largeur} × {image.hauteur}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-6 py-4">
        <Text size="small" weight="plus">Bien choisir ses images</Text>
        <ul className="text-ui-fg-subtle mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Format paysage, 1600 px de large au minimum — idéalement 1920 × 850 px. JPEG, PNG ou WebP, 10 Mo au plus.</li>
          <li>Pas de texte dans l'image : le titre et les boutons sont ajoutés par le site.</li>
          <li>
            Sur ordinateur, la moitié gauche est voilée derrière le texte : gardez le sujet à droite. Sur
            mobile, l'image s'affiche sous le texte, recadrée vers la droite.
          </li>
          <li>8 images au plus. La première est celle qui s'affiche au chargement de la page.</li>
        </ul>
      </div>
    </Container>
  )
}

export default BannierePage
