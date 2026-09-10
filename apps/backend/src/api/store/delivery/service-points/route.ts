import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SendcloudClient } from "../../../../modules/sendcloud/lib/client"
import { sendcloudOptionsFromEnv } from "../../../../modules/sendcloud/lib/options"
import { regrouperParLieu } from "../../../../modules/sendcloud/lib/service-points"

/** Au-delà, la carte devient illisible et la réponse inutilement lourde. */
const MAX_POINTS = 100

/**
 * Recherche de points relais, pour le sélecteur du tunnel de commande.
 *
 * Le front ne peut pas interroger Sendcloud directement : la clé secrète donnerait à
 * n'importe quel visiteur la main sur le compte. Cette route sert d'intermédiaire et ne
 * rend que ce que l'affichage exige.
 *
 * Trois cadrages, exclusifs entre eux côté Sendcloud : par code postal à l'ouverture du
 * sélecteur, par coordonnées et rayon quand le client se géolocalise, par rectangle
 * englobant quand il déplace la carte.
 *
 *   GET /store/delivery/service-points?postal_code=68870&carriers=colissimo,chronopost
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const query = req.query as Record<string, string | undefined>
  const options = sendcloudOptionsFromEnv()

  if (!options.publicKey || !options.secretKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "La recherche de points relais n'est pas configurée."
    )
  }

  const countryCode = (query.country_code || options.defaultCountryCode || "FR").toUpperCase()
  const carriers = query.carriers?.split(",").map((c) => c.trim()).filter(Boolean)

  const bounds =
    query.ne_lat && query.ne_lng && query.sw_lat && query.sw_lng
      ? { neLat: query.ne_lat, neLng: query.ne_lng, swLat: query.sw_lat, swLng: query.sw_lng }
      : undefined

  // Une seule source de localisation à la fois, sans quoi Sendcloud répond 400. L'ordre
  // reflète la précision : un rectangle de carte prime sur des coordonnées, qui priment
  // sur un code postal saisi.
  const localisation = bounds
    ? { bounds }
    : query.latitude && query.longitude
      ? {
          latitude: query.latitude,
          longitude: query.longitude,
          radius: query.radius ? Number(query.radius) : undefined,
        }
      : { postalCode: query.postal_code, city: query.city }

  if (!bounds && !query.latitude && !query.postal_code) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Indiquer un code postal, des coordonnées, ou un rectangle de carte."
    )
  }

  const client = new SendcloudClient(options)
  const recherche = await client.listServicePoints({
    countryCode,
    carrierCodes: carriers,
    ...localisation,
  })

  res.json({
    // Point de référence retenu par Sendcloud : c'est sur lui qu'il faut centrer la carte,
    // plutôt que sur une position devinée à partir de la saisie.
    center: recherche.geocoding
      ? { latitude: recherche.geocoding.latitude, longitude: recherche.geocoding.longitude }
      : null,
    points: regrouperParLieu(recherche.results).slice(0, MAX_POINTS),
  })
}
