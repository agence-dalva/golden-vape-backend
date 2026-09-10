import { defineMiddlewares, shouldCompressResponse } from "@medusajs/framework/http"
import compression from "compression"
import multer from "multer"

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

export default defineMiddlewares({
  routes: [
    /*
      Compression des réponses de la boutique.

      Medusa expose l'option `http.compression` et le filtre qui la lit, mais n'applique le
      middleware nulle part : c'est à nous de le poser. Le filtre consulte la configuration à
      chaque requête et honore l'en-tête `x-no-compression`, d'où l'interrupteur laissé dans
      `medusa-config.ts` plutôt que répété ici. Niveau et seuil restent ceux de la
      bibliothèque, identiques aux valeurs par défaut de Medusa.

      Mesuré sur la recherche : 27 747 octets bruts contre 6 447 gzippés, 4,3×. Cantonné à
      `/store` — c'est là qu'est le trafic, et l'administration n'a pas à en dépendre.
    */
    {
      matcher: "/store/*",
      middlewares: [compression({ filter: shouldCompressResponse })],
    },
    {
      matcher: "/admin/attribute-types/:id/values/:value/image",
      method: ["POST"],
      middlewares: [upload.single("file")],
    },
    {
      // Le sceau Monetico se calcule sur le corps brut de la notification.
      matcher: "/hooks/payment/monetico_monetico",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
    {
      // Meme raison chez Sendcloud : la signature HMAC porte sur les octets recus, pas
      // sur un objet re-serialise.
      matcher: "/hooks/delivery/sendcloud",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
  ],
})
