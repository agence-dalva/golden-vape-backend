import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { buildPaymentRequest } from "../../../../modules/monetico/lib/payment-request"
import { moneticoOptionsFromEnv } from "../../../../modules/monetico/lib/options"
import type {
  MoneticoAddress,
  MoneticoOrderContext,
} from "../../../../modules/monetico/types"

export const MONETICO_PROVIDER_ID = "pp_monetico_monetico"

type CartAddress = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  postal_code?: string | null
  country_code?: string | null
  province?: string | null
  phone?: string | null
}

/**
 * Construit le formulaire scellé de la phase « Aller » pour le panier demandé.
 *
 * Le montant n'est jamais lu depuis la requête : il vient de la session de paiement
 * rattachée au panier, donc du serveur.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cartId = (req.body as { cart_id?: string })?.cart_id

  if (!cartId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "« cart_id » est requis.")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "currency_code",
      "shipping_address.*",
      "billing_address.*",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.variant_sku",
      "payment_collection.payment_sessions.*",
    ],
    filters: { id: cartId },
  })

  const cart = carts[0]

  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Panier ${cartId} introuvable.`)
  }

  const session = cart.payment_collection?.payment_sessions?.find(
    (candidate) => candidate?.provider_id === MONETICO_PROVIDER_ID
  )

  if (!session) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Aucune session de paiement Monetico n'est ouverte sur ce panier."
    )
  }

  const billing = toMoneticoAddress(cart.billing_address ?? cart.shipping_address)

  if (!billing) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Une adresse de facturation complète est nécessaire pour un paiement Monetico."
    )
  }

  const orderContext: MoneticoOrderContext = {
    billing,
    shipping: toMoneticoAddress(cart.shipping_address) ?? undefined,
    shoppingCart: {
      shoppingCartItems: (cart.items ?? []).flatMap((item) =>
        item
          ? [
              {
                name: item.title ?? undefined,
                unitPrice: Number(item.unit_price),
                quantity: Number(item.quantity),
                productSKU: item.variant_sku ?? undefined,
              },
            ]
          : []
      ),
    },
    client: { email: cart.email ?? undefined },
  }

  const form = buildPaymentRequest({
    options: moneticoOptionsFromEnv(),
    reference: (session.data?.reference as string) ?? session.id.slice(-12).toUpperCase(),
    amount: Number(session.amount),
    currencyCode: session.currency_code,
    // Repris tel quel dans l'interface « Retour » : c'est ainsi qu'on retrouve la session.
    texteLibre: session.id,
    orderContext,
    email: cart.email,
  })

  res.json(form)
}

function toMoneticoAddress(address?: CartAddress | null): MoneticoAddress | null {
  if (!address?.address_1 || !address.city || !address.postal_code || !address.country_code) {
    return null
  }

  return {
    firstName: address.first_name ?? undefined,
    lastName: address.last_name ?? undefined,
    addressLine1: address.address_1,
    addressLine2: address.address_2 ?? undefined,
    city: address.city,
    postalCode: address.postal_code,
    country: address.country_code.toUpperCase(),
    stateOrProvince: address.province ?? undefined,
    phone: address.phone ?? undefined,
  }
}
