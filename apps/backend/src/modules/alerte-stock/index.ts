import { Module } from "@medusajs/framework/utils"
import AlerteStockModuleService from "./service"

export const ALERTE_STOCK_MODULE = "alerteStock"

export default Module(ALERTE_STOCK_MODULE, {
  service: AlerteStockModuleService,
})
