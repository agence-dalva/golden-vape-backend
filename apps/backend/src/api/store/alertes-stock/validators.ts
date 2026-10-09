import { z } from "@medusajs/framework/zod"

/**
 * Une adresse et une déclinaison, rien d'autre. L'adresse est ramenée en minuscules : deux
 * saisies de la même boîte ne doivent pas donner deux demandes.
 */
export const CreerAlerteStock = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  variant_id: z.string().trim().min(1).max(64),
})

export type CreerAlerteStockType = z.infer<typeof CreerAlerteStock>
