import { Button, Facts, Layout, Paragraph, Title } from "./layout"

export type LieuRetraitEmail = {
  nom: string | null
  address_1: string | null
  postal_code: string | null
  city: string | null
}

export type OrderReadyForPickupData = {
  display_id: number
  customer_name: string | null
  lieu: LieuRetraitEmail
  order_url: string | null
}

export function orderReadyForPickupSubject(data: OrderReadyForPickupData): string {
  return `Votre commande n°${data.display_id} est prête à retirer`
}

/** Le lieu de retrait sur deux lignes : la boutique, puis son adresse. */
export function LieuRetrait({ lieu }: { lieu: LieuRetraitEmail }) {
  return (
    <>
      {lieu.nom}
      {lieu.address_1 && (
        <>
          <br />
          {lieu.address_1}
        </>
      )}
      <br />
      {lieu.postal_code} {lieu.city}
    </>
  )
}

export function OrderReadyForPickupEmail({ data, storefrontUrl }: { data: OrderReadyForPickupData; storefrontUrl: string }) {
  const prenom = data.customer_name?.split(" ")[0]

  return (
    <Layout preview={`Commande n°${data.display_id} prête — elle vous attend en boutique.`} storefrontUrl={storefrontUrl}>
      <Title>Votre commande vous attend{prenom ? `, ${prenom}` : ""}</Title>
      <Paragraph>
        Votre commande <strong>n°{data.display_id}</strong> est prête. Elle est déjà réglée : il ne
        vous reste qu&apos;à venir la chercher en boutique et à donner ce numéro au comptoir.
      </Paragraph>

      <Facts
        rows={[
          { label: "Lieu de retrait", value: <LieuRetrait lieu={data.lieu} /> },
          { label: "À donner au comptoir", value: `Commande n°${data.display_id}` },
        ]}
      />

      {data.order_url && <Button href={data.order_url}>Voir ma commande</Button>}
    </Layout>
  )
}
