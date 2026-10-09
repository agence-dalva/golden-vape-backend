import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { imageSize } from "image-size"
import { BANNIERE_MODULE } from "../../../modules/banniere"
import type BanniereModuleService from "../../../modules/banniere/service"
import { ajouterImageBanniereWorkflow } from "../../../workflows/banniere"

// La bannière couvre toute la largeur de l'écran : en dessous, l'image serait agrandie et
// floue sur un grand écran. L'actuelle fait 1885 × 834.
const LARGEUR_MIN = 1600
// Plus étroite, elle serait recadrée au point de perdre son sujet sur ordinateur.
const RATIO_MIN = 1.6
const IMAGES_MAX = 8
const TYPES = ["image/jpeg", "image/png", "image/webp"]

// GET /admin/banniere — les images, dans l'ordre d'affichage.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const banniere = req.scope.resolve<BanniereModuleService>(BANNIERE_MODULE)
  const images = await banniere.listImageBannieres({}, { order: { rang: "ASC", created_at: "ASC" } })
  res.json({ images })
}

// POST /admin/banniere — multipart, champ « file » : ajoute une image en dernière position.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const fichier = req.file
  if (!fichier) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Aucun fichier reçu.")
  }
  if (!TYPES.includes(fichier.mimetype)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Format refusé : JPEG, PNG ou WebP uniquement.")
  }

  let largeur: number | undefined
  let hauteur: number | undefined
  try {
    ;({ width: largeur, height: hauteur } = imageSize(fichier.buffer))
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Fichier image illisible.")
  }
  if (!largeur || !hauteur) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Dimensions de l'image introuvables.")
  }
  if (largeur < LARGEUR_MIN) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Image trop petite (${largeur} px de large) : ${LARGEUR_MIN} px minimum pour rester nette en plein écran.`
    )
  }
  if (largeur / hauteur < RATIO_MIN) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Image pas assez large (${largeur} × ${hauteur}) : il faut un format paysage, au moins ${RATIO_MIN} fois plus large que haut.`
    )
  }

  const banniere = req.scope.resolve<BanniereModuleService>(BANNIERE_MODULE)
  const [, nombre] = await banniere.listAndCountImageBannieres({}, { take: 1 })
  if (nombre >= IMAGES_MAX) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${IMAGES_MAX} images au plus : retirez-en une d'abord.`)
  }

  const { result: image } = await ajouterImageBanniereWorkflow(req.scope).run({
    input: {
      nom: fichier.originalname.replace(/[^\w.-]+/g, "-"),
      type: fichier.mimetype,
      contenuBase64: fichier.buffer.toString("base64"),
      largeur,
      hauteur,
    },
  })

  res.status(201).json({ image })
}
