import { Module } from "@medusajs/framework/utils"
import ProductAttributeModuleService from "./service"

export const PRODUCT_ATTRIBUTE_MODULE = "productAttribute"

export default Module(PRODUCT_ATTRIBUTE_MODULE, {
  service: ProductAttributeModuleService,
})
