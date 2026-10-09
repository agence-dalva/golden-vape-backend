import { Module } from "@medusajs/framework/utils"
import BanniereModuleService from "./service"

export const BANNIERE_MODULE = "banniere"

export default Module(BANNIERE_MODULE, {
  service: BanniereModuleService,
})
