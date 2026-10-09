import { MedusaService } from "@medusajs/framework/utils"
import AlerteStock from "./models/alerte-stock"

class AlerteStockModuleService extends MedusaService({ AlerteStock }) {}

export default AlerteStockModuleService
