import { Button, Facts, Layout, Paragraph, Title } from "./layout"

export type ShipmentCreatedData = {
  display_id: number
  customer_name: string | null
  shipping_method: string | null
  service_point_name: string | null
  tracking_number: string | null
  tracking_url: string | null
  order_url: string | null
}

export function shipmentCreatedSubject(data: ShipmentCreatedData): string {
  return `Votre commande n°${data.display_id} est en route`
}

export function ShipmentCreatedEmail({ data, storefrontUrl }: { data: ShipmentCreatedData; storefrontUrl: string }) {
  const prenom = data.customer_name?.split(" ")[0]

  return (
    <Layout preview={`Votre colis est parti — commande n°${data.display_id}.`} storefrontUrl={storefrontUrl}>
      <Title>Votre colis est en route{prenom ? `, ${prenom}` : ""}</Title>
      <Paragraph>
        Votre commande <strong>n°{data.display_id}</strong> a été remise au transporteur.
        {data.service_point_name
          ? " Vous serez prévenu dès qu'elle sera disponible en point relais."
          : " Elle arrive bientôt chez vous."}
      </Paragraph>

      <Facts
        rows={[
          ...(data.shipping_method ? [{ label: "Livraison", value: data.shipping_method }] : []),
          ...(data.service_point_name ? [{ label: "Point relais", value: data.service_point_name }] : []),
          ...(data.tracking_number ? [{ label: "Numéro de suivi", value: data.tracking_number }] : []),
        ]}
      />

      {data.tracking_url ? (
        <Button href={data.tracking_url}>Suivre le colis</Button>
      ) : data.order_url ? (
        <Button href={data.order_url}>Voir ma commande</Button>
      ) : null}

      {data.tracking_url && data.order_url && (
        <Paragraph muted>
          Le détail de votre commande reste disponible dans{" "}
          <a href={data.order_url} style={{ color: "#44362e" }}>
            votre espace client
          </a>
          .
        </Paragraph>
      )}
    </Layout>
  )
}
