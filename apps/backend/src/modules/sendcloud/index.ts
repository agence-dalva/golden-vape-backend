import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SendcloudFulfillmentProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [SendcloudFulfillmentProviderService],
})
