import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Container, Copy, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

/**
 * Paiement Monetico d'une commande : ce qu'il faut pour le retrouver dans le TPE virtuel.
 *
 * Le bloc « Paiements » de Medusa n'affiche que son propre identifiant. Or pour un
 * recrédit, une contestation ou une simple vérification, le marchand cherche dans le
 * back-office Monetico par *référence* — celle qu'on a envoyée au paiement, que la
 * notification nous a renvoyée avec le numéro d'autorisation et la carte masquée. Tout
 * cela dort dans `payment.data` ; cette carte le remonte.
 */
export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

type Confirmation = {
  reference?: string
  numauto?: string
  montant?: string
  date?: string
  brand?: string
  cbmasquee?: string
  code_retour?: string
}

type Paiement = {
  id: string
  provider_id: string
  captured_at: string | null
  canceled_at: string | null
  data?: { reference?: string; monetico?: Confirmation } | null
}

const PROVIDER_MONETICO = "pp_monetico_monetico"

/** « 02/09/2026_a_12:00:00 », tel que Monetico l'écrit, rendu lisible. */
function dateLisible(brute?: string): string | null {
  if (!brute) return null
  const [jour, heure] = brute.split("_a_")
  return heure ? `${jour} à ${heure.slice(0, 5)}` : jour
}

const MoneticoPaymentWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [paiements, setPaiements] = useState<Paiement[] | null>(null)

  useEffect(() => {
    let annule = false

    fetch(`/admin/orders/${order.id}?fields=*payment_collections.payments`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((corps: { order?: { payment_collections?: { payments?: Paiement[] }[] } } | null) => {
        if (annule) return
        const tous = (corps?.order?.payment_collections ?? []).flatMap((c) => c.payments ?? [])
        setPaiements(tous.filter((p) => p.provider_id === PROVIDER_MONETICO))
      })
      .catch(() => {
        if (!annule) setPaiements([])
      })

    return () => {
      annule = true
    }
  }, [order.id])

  // Commande réglée autrement — provisoire, manuelle — : rien à montrer, pas de carte vide.
  if (!paiements || paiements.length === 0) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Paiement Monetico</Heading>
      </div>

      {paiements.map((paiement) => {
        const monetico = paiement.data?.monetico ?? {}
        const reference = monetico.reference ?? paiement.data?.reference
        const lignes: { libelle: string; valeur: string | null; copiable?: boolean }[] = [
          { libelle: "Référence", valeur: reference ?? null, copiable: true },
          { libelle: "N° d'autorisation", valeur: monetico.numauto ?? null, copiable: true },
          { libelle: "Date", valeur: dateLisible(monetico.date) },
          { libelle: "Montant", valeur: monetico.montant ?? null },
          {
            libelle: "Carte",
            valeur: [monetico.brand !== "na" ? monetico.brand : null, monetico.cbmasquee]
              .filter(Boolean)
              .join(" ") || null,
          },
        ]

        return (
          <div key={paiement.id} className="text-ui-fg-subtle grid gap-y-3 px-6 py-4">
            {lignes
              .filter((l) => l.valeur)
              .map((l) => (
                <div key={l.libelle} className="grid grid-cols-2 items-center gap-x-4">
                  <Text size="small" leading="compact" weight="plus">
                    {l.libelle}
                  </Text>
                  <div className="flex items-center gap-x-2">
                    <Text size="small" leading="compact" className="text-ui-fg-base">
                      {l.valeur}
                    </Text>
                    {l.copiable && <Copy content={l.valeur!} className="text-ui-fg-muted" />}
                  </div>
                </div>
              ))}
            {!paiement.captured_at && !paiement.canceled_at && (
              <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                Confirmation Monetico non reçue : ce paiement n'est pas encore capturé.
              </Text>
            )}
          </div>
        )
      })}

      <div className="px-6 py-4">
        <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
          Pour un recrédit ou une vérification, retrouver le paiement dans le TPE virtuel Monetico
          par sa référence.
        </Text>
      </div>
    </Container>
  )
}

export default MoneticoPaymentWidget
