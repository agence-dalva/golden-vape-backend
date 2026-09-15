import type { CreateFulfillmentResult } from "@medusajs/framework/types"
import type { SendcloudAnnouncedParcel, SendcloudShipment } from "../types"

/** Chemin de la route d'administration qui sert l'étiquette d'un colis. */
export const LABEL_ROUTE_PREFIX = "/admin/delivery/labels"

/**
 * Lien d'étiquette rendu à Medusa pour un colis.
 *
 * L'admin l'ouvre dans un nouvel onglet ; la route vérifie la session, puis va chercher
 * le PDF chez Sendcloud avec les clés API. Sans URL de backend connue, on retombe sur le
 * lien Sendcloud lui-même : il ne s'ouvrira pas dans un navigateur, mais reste exact et
 * exploitable avec les clés.
 */
export function urlEtiquette(
  colis: SendcloudAnnouncedParcel,
  backendUrl: string | undefined
): string {
  if (backendUrl) {
    return `${backendUrl}${LABEL_ROUTE_PREFIX}/${colis.id}`
  }

  return colis.documents?.find((d) => d.type === "label")?.link ?? ""
}

/**
 * Ramène les colis d'une expédition à la forme attendue par Medusa.
 *
 * Une expédition peut porter plusieurs colis ; chacun a son numéro de suivi et son
 * étiquette, et Medusa en fait autant de `FulfillmentLabel`.
 */
export function labelsPourMedusa(
  expedition: SendcloudShipment,
  backendUrl: string | undefined
): CreateFulfillmentResult["labels"] {
  return (expedition.parcels ?? []).map((colis) => ({
    tracking_number: colis.tracking_number ?? "",
    tracking_url: colis.tracking_url ?? "",
    label_url: urlEtiquette(colis, backendUrl),
  }))
}

/**
 * L'expédition telle qu'on la conserve avec le fulfillment.
 *
 * `label_file` est le PDF entier en base64 : le garder dans la colonne JSON du fulfillment
 * la ferait grossir de centaines de kilo-octets par commande, pour un document que
 * Sendcloud rend à la demande. Identifiants, suivi et liens suffisent — l'annulation n'a
 * besoin que de `id`.
 */
export function sansFichiers(expedition: SendcloudShipment): SendcloudShipment {
  return {
    ...expedition,
    parcels: expedition.parcels?.map(({ label_file: _fichier, ...colis }) => colis),
  }
}
