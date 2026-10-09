import { z } from "@medusajs/framework/zod"

export const OrdreBanniere = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
})

export type OrdreBanniereType = z.infer<typeof OrdreBanniere>
