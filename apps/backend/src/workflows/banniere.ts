import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import { BANNIERE_MODULE } from "../modules/banniere"
import type BanniereModuleService from "../modules/banniere/service"

/*
  Bannière d'accueil : ajouter une image, la retirer, changer l'ordre.

  Chaque écriture passe par une étape compensable : un fichier envoyé chez R2 dont la ligne
  n'a pas pu être créée est supprimé, plutôt que de rester orphelin dans le bucket.
*/

type Fichier = { nom: string; type: string; contenuBase64: string; largeur: number; hauteur: number }

const envoyerFichierBanniereStep = createStep(
  "envoyer-fichier-banniere",
  async (fichier: Fichier, { container }) => {
    const fichiers = container.resolve(Modules.FILE)
    const envoye = await fichiers.createFiles({
      filename: `banniere/${Date.now()}-${fichier.nom}`,
      mimeType: fichier.type,
      content: fichier.contenuBase64,
      access: "public",
    })
    return new StepResponse(envoye, envoye.id)
  },
  async (id, { container }) => {
    if (id) await container.resolve(Modules.FILE).deleteFiles(id)
  }
)

const creerImageBanniereStep = createStep(
  "creer-image-banniere",
  async (
    entree: { url: string; fichier_id: string; largeur: number; hauteur: number },
    { container }
  ) => {
    const banniere = container.resolve<BanniereModuleService>(BANNIERE_MODULE)
    // La nouvelle image se place en dernier : on ajoute à la suite, on réordonne ensuite.
    const existantes = await banniere.listImageBannieres({}, { select: ["rang"] })
    const rang = existantes.reduce((max, i) => Math.max(max, i.rang), -1) + 1
    const image = await banniere.createImageBannieres({ ...entree, rang })
    return new StepResponse(image, image.id)
  },
  async (id, { container }) => {
    if (id) await container.resolve<BanniereModuleService>(BANNIERE_MODULE).deleteImageBannieres(id)
  }
)

export const ajouterImageBanniereWorkflow = createWorkflow("ajouter-image-banniere", (fichier: Fichier) => {
  const envoye = envoyerFichierBanniereStep(fichier)
  const image = creerImageBanniereStep({
    url: envoye.url,
    fichier_id: envoye.id,
    largeur: fichier.largeur,
    hauteur: fichier.hauteur,
  })
  return new WorkflowResponse(image)
})

/**
 * Retire l'image de la bannière, puis son fichier chez R2. Le fichier part en dernier et sans
 * compensation : une ligne supprimée ne se recrée pas, et un fichier resté au bucket ne gêne
 * personne.
 */
const retirerImageBanniereStep = createStep(
  "retirer-image-banniere",
  async (id: string, { container }) => {
    const banniere = container.resolve<BanniereModuleService>(BANNIERE_MODULE)
    const image = await banniere.retrieveImageBanniere(id)
    await banniere.softDeleteImageBannieres(id)
    return new StepResponse(image.fichier_id, id)
  },
  async (id, { container }) => {
    if (id) await container.resolve<BanniereModuleService>(BANNIERE_MODULE).restoreImageBannieres(id)
  }
)

const supprimerFichierBanniereStep = createStep("supprimer-fichier-banniere", async (fichierId: string, { container }) => {
  await container.resolve(Modules.FILE).deleteFiles(fichierId)
  return new StepResponse(undefined)
})

export const supprimerImageBanniereWorkflow = createWorkflow("supprimer-image-banniere", (entree: { id: string }) => {
  const fichierId = retirerImageBanniereStep(entree.id)
  supprimerFichierBanniereStep(fichierId)
  return new WorkflowResponse(undefined)
})

/** Range les images dans l'ordre donné ; l'ordre précédent est rétabli en cas d'échec. */
const ordonnerImagesBanniereStep = createStep(
  "ordonner-images-banniere",
  async (ids: string[], { container }) => {
    const banniere = container.resolve<BanniereModuleService>(BANNIERE_MODULE)
    const avant = await banniere.listImageBannieres({ id: ids }, { select: ["id", "rang"] })
    await banniere.updateImageBannieres(ids.map((id, rang) => ({ id, rang })))
    return new StepResponse(undefined, avant.map((i) => ({ id: i.id, rang: i.rang })))
  },
  async (avant, { container }) => {
    if (avant?.length) await container.resolve<BanniereModuleService>(BANNIERE_MODULE).updateImageBannieres(avant)
  }
)

export const ordonnerBanniereWorkflow = createWorkflow("ordonner-banniere", (entree: { ids: string[] }) => {
  ordonnerImagesBanniereStep(entree.ids)
  return new WorkflowResponse(undefined)
})
