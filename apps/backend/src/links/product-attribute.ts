import ProductModule from "@medusajs/medusa/product"
import ProductAttributeModule from "../modules/product-attribute"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ProductAttributeModule.linkable.productAttributeValue,
    isList: true,
  }
)
