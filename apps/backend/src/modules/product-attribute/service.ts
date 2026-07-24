import { MedusaService } from "@medusajs/framework/utils"
import AttributeType from "./models/attribute-type"
import ProductAttributeValue from "./models/product-attribute-value"
import AttributeValueImage from "./models/attribute-value-image"

class ProductAttributeModuleService extends MedusaService({
  AttributeType,
  ProductAttributeValue,
  AttributeValueImage,
}) {}

export default ProductAttributeModuleService
