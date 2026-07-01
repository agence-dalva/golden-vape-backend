import { MedusaService } from "@medusajs/framework/utils"
import AttributeType from "./models/attribute-type"
import ProductAttributeValue from "./models/product-attribute-value"

class ProductAttributeModuleService extends MedusaService({
  AttributeType,
  ProductAttributeValue,
}) {}

export default ProductAttributeModuleService
