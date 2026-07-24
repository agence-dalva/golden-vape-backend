import { defineMiddlewares } from "@medusajs/framework/http"
import multer from "multer"

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/attribute-types/:id/values/:value/image",
      method: ["POST"],
      middlewares: [upload.single("file")],
    },
  ],
})
