import { Button, Facts, Layout, Paragraph, Title } from "./layout"

export type LieuRetraitEmail = {
  nom: string | null
  address_1: string | null
  postal_code: string | null
  city: string | null
  horaires?: { jours: string; heures: string }[]
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

/** Une ligne par plage de jours : « Mardi au vendredi : 10h – 12h30 · 14h – 19h ». */
export function HorairesRetrait({ lieu }: { lieu: LieuRetraitEmail }) {
  return (
    <>
      {(lieu.horaires ?? []).map((h, i) => (
        <span key={h.jours}>
          {i > 0 && <br />}
          <span style={{ fontWeight: 400 }}>{h.jours} :</span> {h.heures}
        </span>
      ))}
    </>
  )
}

/** Les lignes « Lieu » et « Horaires », communes à la confirmation et à « prête à retirer ». */
export function lignesRetrait(lieu: LieuRetraitEmail) {
  return [
    { label: "Lieu de retrait", value: <LieuRetrait lieu={lieu} /> },
    ...(lieu.horaires?.length ? [{ label: "Horaires", value: <HorairesRetrait lieu={lieu} /> }] : []),
  ]
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
          ...lignesRetrait(data.lieu),
          { label: "À donner au comptoir", value: `Commande n°${data.display_id}` },
        ]}
      />

      {/* Vente interdite aux mineurs : sur le site, l'âge n'est que déclaré ; au comptoir, le
          marchand peut le vérifier. Demandé par le marchand le 14/10/2026. */}
      <Paragraph>Une pièce d&apos;identité pourra vous être demandée lors du retrait.</Paragraph>

      {data.order_url && <Button href={data.order_url}>Voir ma commande</Button>}
    </Layout>
  )
}
