import { BRAND, Button, Divider, Facts, Layout, Paragraph, Title, formatDate, formatMoney } from "./layout"

export type OrderPlacedData = {
  display_id: number
  created_at: string
  currency_code: string
  customer_name: string | null
  items: { title: string; variant_title: string | null; quantity: number; total: number }[]
  item_total: number
  shipping_total: number
  tax_total: number
  discount_total: number
  total: number
  shipping_method: string | null
  service_point_name: string | null
  shipping_address: {
    first_name?: string | null
    last_name?: string | null
    address_1?: string | null
    address_2?: string | null
    postal_code?: string | null
    city?: string | null
  } | null
  /** Suivi dans l'espace client — seulement si la commande est rattachée à un compte. */
  order_url: string | null
}

export function orderPlacedSubject(data: OrderPlacedData): string {
  return `Votre commande n°${data.display_id} est confirmée`
}

export function OrderPlacedEmail({ data, storefrontUrl }: { data: OrderPlacedData; storefrontUrl: string }) {
  const devise = data.currency_code
  const prenom = data.customer_name?.split(" ")[0]
  const adresse = data.shipping_address

  return (
    <Layout preview={`Commande n°${data.display_id} confirmée — merci pour votre confiance.`} storefrontUrl={storefrontUrl}>
      <Title>Merci{prenom ? `, ${prenom}` : ""} !</Title>
      <Paragraph>
        Votre commande <strong>n°{data.display_id}</strong> du {formatDate(data.created_at)} est confirmée.
        Nous la préparons avec soin ; vous recevrez un email dès que votre colis sera en route.
      </Paragraph>

      <Divider />

      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          {data.items.map((item, index) => (
            <tr key={index}>
              <td style={{ padding: "8px 0", fontSize: 14, color: BRAND.text, borderBottom: `1px solid ${BRAND.border}` }}>
                {item.title}
                {item.variant_title && (
                  <span style={{ color: BRAND.textSoft }}> · {item.variant_title}</span>
                )}
                <span style={{ color: BRAND.textSoft }}> × {item.quantity}</span>
              </td>
              <td
                align="right"
                style={{ padding: "8px 0", fontSize: 14, fontWeight: 600, color: BRAND.text, borderBottom: `1px solid ${BRAND.border}`, whiteSpace: "nowrap" }}
              >
                {formatMoney(item.total, devise)}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ padding: "12px 0 4px", fontSize: 14, color: BRAND.textSoft }}>Sous-total</td>
            <td align="right" style={{ padding: "12px 0 4px", fontSize: 14, color: BRAND.textSoft }}>{formatMoney(data.item_total, devise)}</td>
          </tr>
          {data.discount_total > 0 && (
            <tr>
              <td style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>Remise</td>
              <td align="right" style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>− {formatMoney(data.discount_total, devise)}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>
              Livraison{data.shipping_method ? ` · ${data.shipping_method}` : ""}
            </td>
            <td align="right" style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>
              {data.shipping_total === 0 ? "Offerte" : formatMoney(data.shipping_total, devise)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>dont TVA</td>
            <td align="right" style={{ padding: "4px 0", fontSize: 14, color: BRAND.textSoft }}>{formatMoney(data.tax_total, devise)}</td>
          </tr>
          <tr>
            <td style={{ padding: "12px 0 0", fontSize: 16, fontWeight: 700, color: BRAND.brownDeep, borderTop: `1px solid ${BRAND.border}` }}>Total</td>
            <td align="right" style={{ padding: "12px 0 0", fontSize: 16, fontWeight: 700, color: BRAND.brownDeep, borderTop: `1px solid ${BRAND.border}` }}>
              {formatMoney(data.total, devise)}
            </td>
          </tr>
        </tbody>
      </table>

      <Divider />

      <Facts
        rows={[
          ...(data.shipping_method ? [{ label: "Mode de livraison", value: data.shipping_method }] : []),
          ...(data.service_point_name ? [{ label: "Point relais", value: data.service_point_name }] : []),
          ...(adresse
            ? [
                {
                  label: data.service_point_name ? "Vos coordonnées" : "Adresse de livraison",
                  value: (
                    <>
                      {[adresse.first_name, adresse.last_name].filter(Boolean).join(" ")}
                      <br />
                      {adresse.address_1}
                      {adresse.address_2 && (
                        <>
                          <br />
                          {adresse.address_2}
                        </>
                      )}
                      <br />
                      {adresse.postal_code} {adresse.city}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />

      {data.order_url ? (
        <Button href={data.order_url}>Suivre ma commande</Button>
      ) : (
        <Paragraph muted>
          Gardez cet email : il fait office de récapitulatif. Vous pouvez aussi créer un compte
          avec cette adresse pour suivre vos prochaines commandes.
        </Paragraph>
      )}
    </Layout>
  )
}
