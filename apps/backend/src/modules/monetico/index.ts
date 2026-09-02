import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import MoneticoProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [MoneticoProviderService],
})
