import { Button, Layout, Paragraph, Title, formatMoney } from "./layout"

export type OrderCanceledData = {
  display_id: number
  customer_name: string | null
  total: number
  currency_code: string
  /** Le paiement a-t-il été remboursé (ou n'a jamais été encaissé) ? */
  refunded: boolean
  order_url: string | null
}

export function orderCanceledSubject(data: OrderCanceledData): string {
  return `Votre commande n°${data.display_id} a été annulée`
}

export function OrderCanceledEmail({ data, storefrontUrl }: { data: OrderCanceledData; storefrontUrl: string }) {
  const prenom = data.customer_name?.split(" ")[0]

  return (
    <Layout preview={`Commande n°${data.display_id} annulée.`} storefrontUrl={storefrontUrl}>
      <Title>Commande annulée{prenom ? `, ${prenom}` : ""}</Title>
      <Paragraph>
        Votre commande <strong>n°{data.display_id}</strong> d'un montant de{" "}
        {formatMoney(data.total, data.currency_code)} a été annulée.
      </Paragraph>
      <Paragraph>
        {data.refunded
          ? "Le montant réglé est remboursé sur le moyen de paiement utilisé ; il apparaît sous quelques jours ouvrés selon votre banque."
          : "Si un paiement a été effectué, il vous sera remboursé sur le moyen de paiement utilisé sous quelques jours ouvrés."}
      </Paragraph>
      <Paragraph muted>
        Si vous n'êtes pas à l'origine de cette annulation, répondez à cet email en rappelant le
        numéro de commande : nous nous en occupons.
      </Paragraph>
      {data.order_url && <Button href={data.order_url}>Voir ma commande</Button>}
    </Layout>
  )
}
