import { model } from "@medusajs/framework/utils"

/**
 * Une image de la bannière d'accueil.
 *
 * `fichier_id` est la clé du fichier chez le provider (R2) : c'est elle qui permet de le
 * supprimer avec la ligne. `rang` donne l'ordre d'affichage, du plus petit au plus grand.
 */
const ImageBanniere = model.define("image_banniere", {
  id: model.id({ prefix: "bnim" }).primaryKey(),
  url: model.text(),
  fichier_id: model.text(),
  largeur: model.number(),
  hauteur: model.number(),
  rang: model.number().default(0),
})

export default ImageBanniere
