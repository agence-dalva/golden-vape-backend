import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ALERTE_STOCK_MODULE } from "../modules/alerte-stock"
import type AlerteStockModuleService from "../modules/alerte-stock/service"

type Entree = { email: string; variant_id: string }

/** Enregistre une demande de retour en stock ; l'annule si la suite du workflow échoue. */
const creerAlerteStockStep = createStep(
  "creer-alerte-stock",
  async (entree: Entree, { container }) => {
    const alertes = container.resolve<AlerteStockModuleService>(ALERTE_STOCK_MODULE)
    const alerte = await alertes.createAlerteStocks(entree)
    return new StepResponse(alerte, alerte.id)
  },
  async (id, { container }) => {
    if (!id) return
    await container.resolve<AlerteStockModuleService>(ALERTE_STOCK_MODULE).deleteAlerteStocks(id)
  }
)

export const creerAlerteStockWorkflow = createWorkflow("creer-alerte-stock", (entree: Entree) => {
  const alerte = creerAlerteStockStep(entree)
  return new WorkflowResponse(alerte)
})
