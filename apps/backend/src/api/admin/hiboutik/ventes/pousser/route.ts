import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { hiboutikOptionsFromEnv } from "../../../../../modules/hiboutik/lib/options"
import { pousserVenteAnnulation, pousserVenteCommande } from "../../../../../modules/hiboutik/lib/ventes"

// POST /admin/hiboutik/ventes/pousser — reporte à la main une commande (ou son annulation) en caisse
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { order_id, type } = (req.body ?? {}) as { order_id?: string; type?: "commande" | "annulation" }
  if (!order_id) {
    return res.status(400).json({ message: "Le champ 'order_id' est requis" })
  }
  if (!hiboutikOptionsFromEnv().salesPush.enabled) {
    return res.status(409).json({ message: "La remontée des ventes vers Hiboutik est désactivée (HIBOUTIK_SALES_PUSH_ENABLED)" })
  }
  try {
    const marqueur =
      type === "annulation"
        ? await pousserVenteAnnulation(req.scope, order_id)
        : await pousserVenteCommande(req.scope, order_id, { force: true })
    res.json({ marqueur })
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Erreur lors du report de la commande dans Hiboutik" })
  }
}
