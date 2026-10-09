import { BRAND, Button, Layout, Paragraph, Title } from "./layout"

export type BackInStockData = {
  product_title: string
  variant_title: string | null
  product_url: string
  image_url: string | null
}

const nomComplet = (data: BackInStockData) =>
  data.variant_title ? `${data.product_title} — ${data.variant_title}` : data.product_title

export function backInStockSubject(data: BackInStockData): string {
  return `De retour en stock : ${nomComplet(data)}`
}

export function BackInStockEmail({ data, storefrontUrl }: { data: BackInStockData; storefrontUrl: string }) {
  return (
    <Layout
      preview={`${nomComplet(data)} est de nouveau disponible.`}
      storefrontUrl={storefrontUrl}
      raison="Vous recevez cet email parce que vous avez demandé à être prévenu du retour de cet article. Nous ne vous écrirons plus à son sujet."
    >
      <Title>C&apos;est de retour !</Title>
      <Paragraph>
        L&apos;article que vous attendiez est de nouveau disponible. Les quantités peuvent partir
        vite : il n&apos;est pas réservé pour vous.
      </Paragraph>

      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: "8px 0 4px" }}>
        <tbody>
          <tr>
            {data.image_url && (
              <td width={88} style={{ paddingRight: 16, verticalAlign: "middle" }}>
                <img
                  src={data.image_url}
                  alt=""
                  width={88}
                  height={88}
                  style={{ display: "block", width: 88, height: 88, objectFit: "contain", border: `1px solid ${BRAND.border}`, borderRadius: 8 }}
                />
              </td>
            )}
            <td style={{ verticalAlign: "middle" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: BRAND.text }}>{data.product_title}</div>
              {data.variant_title && (
                <div style={{ fontSize: 14, color: BRAND.textSoft, marginTop: 2 }}>{data.variant_title}</div>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <Button href={data.product_url}>Voir l&apos;article</Button>
    </Layout>
  )
}
