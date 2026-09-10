import type { SendcloudServicePoint } from "../types"

export type PointRegroupe = {
  key: string
  name: string
  address: SendcloudServicePoint["address"]
  position: SendcloudServicePoint["position"]
  shop_type?: string
  opening_times?: SendcloudServicePoint["opening_times"]
  /** En metres, depuis le point de recherche : sert a trier et a situer. */
  distance?: number
  is_open_tomorrow?: boolean
  next_open_at?: string | null
  /** Un même commerce peut servir plusieurs réseaux ; l'identifiant diffère pour chacun. */
  carriers: {
    code: string
    name: string
    icon_url?: string
    /** Identifiant chez le transporteur : c'est lui qui part à l'affranchissement. */
    service_point_id: string
    sendcloud_id: number
  }[]
}

/**
 * Regroupe les points d'un même lieu physique.
 *
 * Un commerce peut appartenir aux deux réseaux — « EQUIP MOTO » est à la fois point
 * Colissimo et point Chronopost. Sans regroupement, la carte porterait deux épingles
 * superposées à la même adresse, et le client croirait à un doublon.
 */
export function regrouperParLieu(points: SendcloudServicePoint[]): PointRegroupe[] {
  const parLieu = new Map<string, PointRegroupe>()

  for (const point of points) {
    // La position géographique identifie le lieu plus sûrement que son nom, qui varie
    // d'un réseau à l'autre (« Consigne Pickup Leclerc » contre « CONSIGNE PICKUP LECLERC »).
    const cle = point.position
      ? `${point.position.latitude.toFixed(5)},${point.position.longitude.toFixed(5)}`
      : `${point.address.postal_code}|${point.name.toLowerCase()}`

    const existant = parLieu.get(cle)
    const transporteur = {
      code: point.carrier.code,
      name: point.carrier.name,
      icon_url: point.carrier.icon_url,
      service_point_id: point.carrier_service_point_id,
      sendcloud_id: point.id,
    }

    if (existant) {
      existant.carriers.push(transporteur)
      continue
    }

    parLieu.set(cle, {
      key: cle,
      name: point.name,
      address: point.address,
      position: point.position,
      shop_type: point.general_shop_type,
      opening_times: point.opening_times,
      distance: point.distance,
      is_open_tomorrow: point.is_open_tomorrow,
      next_open_at: point.next_open_at,
      carriers: [transporteur],
    })
  }

  // Le plus proche d'abord : c'est le seul critere qui compte pour choisir un relais.
  return [...parLieu.values()].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
}
