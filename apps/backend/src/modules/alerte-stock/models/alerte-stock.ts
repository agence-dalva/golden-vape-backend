import { model } from "@medusajs/framework/utils"

/**
 * Une demande « prévenez-moi du retour en stock » : une adresse, une déclinaison.
 *
 * `notified_at` vide tant que l'email n'est pas parti. La ligne est gardée ensuite : elle dit
 * combien de clients attendaient une référence, et empêche de prévenir deux fois.
 */
const AlerteStock = model
  .define("alerte_stock", {
    id: model.id({ prefix: "alst" }).primaryKey(),
    email: model.text(),
    variant_id: model.text(),
    notified_at: model.dateTime().nullable(),
  })
  .indexes([
    // Une seule demande en attente par adresse et par déclinaison : redemander ne crée rien.
    { on: ["email", "variant_id"], unique: true, where: "notified_at IS NULL" },
    // Le traitement ne lit que les demandes en attente.
    { on: ["variant_id"], where: "notified_at IS NULL" },
  ])

export default AlerteStock
