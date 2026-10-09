import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { BuildingStorefront } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useState } from "react"

/**
 * Bandeau en tête d'une commande à retirer en boutique.
 *
 * Rien ne doit partir par transporteur : le bandeau le dit avant tout le reste, rappelle où
 * en est la commande et ce qu'il reste à faire. Il ne s'affiche pas pour une commande livrée.
 */
export const config = defineWidgetConfig({
  zone: "order.details.before",
})

type Statut = "a_preparer" | "pret" | "retire"

type Retrait = {
  statut: Statut
  lieu: {
    nom: string | null
    address_1: string | null
    postal_code: string | null
    city: string | null
  }
}

const ETAPES: Record<Statut, { libelle: string; couleur: "orange" | "blue" | "green"; suite: string }> = {
  a_preparer: {
    libelle: "À préparer",
    couleur: "orange",
    suite:
      "Préparez la commande puis cliquez sur « Expédier des articles » pour notifier le client que la commande est prête.",
  },
  pret: {
    libelle: "Prête, en attente du client",
    couleur: "blue",
    suite: "Quand le client l'a récupérée, cliquez sur « Marquer comme retirée ».",
  },
  retire: {
    libelle: "Retirée",
    couleur: "green",
    suite: "Le client a récupéré sa commande.",
  },
}

const RetraitBoutiqueCommande = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [retrait, setRetrait] = useState<Retrait | null>(null)

  useEffect(() => {
    let annule = false

    fetch(`/admin/retraits-boutique/${order.id}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((corps: { retrait?: Retrait | null } | null) => {
        if (!annule) setRetrait(corps?.retrait ?? null)
      })
      .catch(() => {
        if (!annule) setRetrait(null)
      })

    return () => {
      annule = true
    }
    // Le statut change quand on traite ou qu'on marque la commande : la page se recharge
    // alors avec une nouvelle version de la commande.
  }, [order.id, order.updated_at])

  if (!retrait) return null

  const etape = ETAPES[retrait.statut]
  const { lieu } = retrait

  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-x-2">
          <BuildingStorefront className="text-ui-fg-subtle" />
          <Heading level="h2">Retrait en boutique</Heading>
        </div>
        <Badge size="small" color={etape.couleur}>
          {etape.libelle}
        </Badge>
      </div>

      <Text size="small" className="text-ui-fg-subtle">
        Payée en ligne, à remettre au client à{" "}
        <span className="text-ui-fg-base">
          {[lieu.nom, lieu.address_1, [lieu.postal_code, lieu.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ")}
        </span>
        .
      </Text>

      <Text size="small" className="text-ui-fg-base">
        {etape.suite}
      </Text>
    </Container>
  )
}

export default RetraitBoutiqueCommande
