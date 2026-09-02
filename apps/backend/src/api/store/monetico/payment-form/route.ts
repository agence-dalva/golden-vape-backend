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
      "items.requires_shipping",
      "items.product.shipping_profile.id",
      "shipping_methods.shipping_option.shipping_profile_id",
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

  // Medusa refait ces contrôles à la finalisation du panier, mais bien après le débit :
  // le client se retrouverait alors payé sans commande. On les rejoue donc AVANT d'ouvrir
  // la page de paiement, où un refus ne coûte rien.
  // query.graph rend un type générique qui ne reflète pas les champs demandés : la forme
  // réelle est celle décrite par ShippableCart.
  assertCartCanBeCompleted(cart as unknown as ShippableCart)

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

type ShippableCart = {
  items?: ({ requires_shipping?: boolean; title?: string | null; product?: { shipping_profile?: { id?: string } | null } | null } | null)[]
  shipping_methods?: ({ shipping_option?: { shipping_profile_id?: string } | null } | null)[]
}

/**
 * Reproduit `validateShippingStep` de Medusa, que la finalisation du panier applique une
 * fois le paiement encaissé. Un article dont le profil d'expédition n'est couvert par aucun
 * mode de livraison choisi fait alors échouer la commande — argent débité, rien à livrer.
 */
function assertCartCanBeCompleted(cart: ShippableCart): void {
  const shippable = (cart.items ?? []).filter((item) => item?.requires_shipping)

  if (shippable.length === 0) {
    return
  }

  const methods = cart.shipping_methods ?? []

  if (methods.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Aucun mode de livraison n'est sélectionné sur ce panier."
    )
  }

  const covered = new Set(
    methods.map((method) => method?.shipping_option?.shipping_profile_id).filter(Boolean)
  )
  const orphans = shippable.filter((item) => !covered.has(item?.product?.shipping_profile?.id))

  if (orphans.length > 0) {
    // Le titre des articles fautifs désigne les produits à rattacher à un profil.
    const titles = [...new Set(orphans.map((item) => item?.title ?? "?"))].slice(0, 5)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Le mode de livraison choisi ne couvre pas le profil d'expédition de : ${titles.join(", ")}.`
    )
  }
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
    // Pas de téléphone : quel que soit le format, Monetico répond « Format invalide pour
    // le(s) champ(s) : /contexte_commande/billing/phone » et refuse tout le paiement.
    // Douze variantes ont été essayées contre le serveur de validation — 0612345678,
    // +33612345678, 0033612345678, +33.612345678, 33612345678, l'objet EMV 3-D Secure
    // { cc, subscriber } —, sous `billing`, `shipping`, `client`, et sur `mobilePhone`.
    // Toutes refusées ; sans le champ, la demande passe. Il est facultatif : on l'omet
    // jusqu'à obtenir le schéma exact auprès de Monetico.
  }
}
