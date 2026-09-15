import type { CSSProperties, ReactNode } from "react"

/**
 * Gabarit commun des emails.
 *
 * Les messageries n'ont ni feuilles de style ni mise en page moderne : tout est en
 * tableaux et en styles posés sur chaque élément, la seule forme que Gmail, Outlook et
 * Apple Mail rendent de la même façon. Les couleurs sont celles de la boutique — brun
 * profond sur crème — et la police retombe sur les fontes système, un email ne charge
 * pas de fonte tierce.
 *
 * Pas de bibliothèque : le HTML d'un email tient en quelques éléments, et la dépendance
 * `@react-email/components` est aujourd'hui abandonnée sur npm.
 */

export const BRAND = {
  brown: "#44362e",
  brownDeep: "#2c2521",
  text: "#2c2521",
  textSoft: "#706761",
  textMuted: "#9a918b",
  border: "#e7e0db",
  cream: "#f6f2ef",
  page: "#fdfcfb",
  card: "#ffffff",
  success: "#486a54",
  danger: "#9c4b45",
}

export const FONT = "Manrope, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

const styles = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: BRAND.cream,
    fontFamily: FONT,
    color: BRAND.text,
    WebkitTextSizeAdjust: "100%",
  } as CSSProperties,
  wrapper: { width: "100%", backgroundColor: BRAND.cream } as CSSProperties,
  container: { width: "100%", maxWidth: 600, margin: "0 auto" } as CSSProperties,
  header: { padding: "32px 24px 20px", textAlign: "center" } as CSSProperties,
  card: {
    backgroundColor: BRAND.card,
    borderRadius: 14,
    border: `1px solid ${BRAND.border}`,
    padding: "32px 32px 28px",
  } as CSSProperties,
  footer: {
    padding: "24px 24px 40px",
    textAlign: "center",
    fontSize: 12,
    lineHeight: "18px",
    color: BRAND.textMuted,
  } as CSSProperties,
  preheader: {
    display: "none",
    fontSize: 1,
    lineHeight: "1px",
    maxHeight: 0,
    maxWidth: 0,
    opacity: 0,
    overflow: "hidden",
  } as CSSProperties,
}

export function Layout({
  preview,
  storefrontUrl,
  children,
}: {
  /** Texte d'aperçu, lu par la messagerie avant l'ouverture. */
  preview: string
  storefrontUrl: string
  children: ReactNode
}) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{preview}</title>
      </head>
      <body style={styles.body}>
        <div style={styles.preheader}>{preview}</div>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={styles.wrapper}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "0 12px" }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={styles.container}>
                  <tbody>
                    <tr>
                      <td style={styles.header}>
                        <a href={storefrontUrl} style={{ textDecoration: "none" }}>
                          <img
                            src={`${storefrontUrl}/logos/logo-horizontal-web.png`}
                            alt="Golden Vape"
                            width={190}
                            style={{ display: "block", margin: "0 auto", width: 190, height: "auto", border: 0 }}
                          />
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.card}>{children}</td>
                    </tr>
                    <tr>
                      <td style={styles.footer}>
                        Golden Vape · 18 avenue de la République, 70200 Lure
                        <br />
                        Vous recevez cet email parce qu'une commande ou un compte est associé à cette adresse.
                        <br />
                        <a href={storefrontUrl} style={{ color: BRAND.textMuted }}>
                          {storefrontUrl.replace(/^https?:\/\//, "")}
                        </a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

/* ── Briques partagées entre les templates ─────────────────────────────────── */

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        margin: "0 0 12px",
        fontSize: 24,
        lineHeight: "30px",
        fontWeight: 600,
        color: BRAND.brownDeep,
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h1>
  )
}

export function Paragraph({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <p
      style={{
        margin: "0 0 14px",
        fontSize: 15,
        lineHeight: "23px",
        color: muted ? BRAND.textSoft : BRAND.text,
      }}
    >
      {children}
    </p>
  )
}

export function Button({ href, children }: { href: string; children: ReactNode }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: "22px 0 8px" }}>
      <tbody>
        <tr>
          <td
            style={{
              backgroundColor: BRAND.brown,
              borderRadius: 8,
            }}
          >
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "13px 24px",
                fontSize: 14,
                fontWeight: 600,
                color: "#ffffff",
                textDecoration: "none",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/** Deux colonnes libellé / valeur, pour un récapitulatif. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: "6px 0 18px" }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td
              style={{
                padding: "7px 0",
                fontSize: 14,
                color: BRAND.textSoft,
                borderBottom: `1px solid ${BRAND.border}`,
                width: "40%",
              }}
            >
              {row.label}
            </td>
            <td
              style={{
                padding: "7px 0",
                fontSize: 14,
                fontWeight: 600,
                color: BRAND.text,
                borderBottom: `1px solid ${BRAND.border}`,
              }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Divider() {
  return <hr style={{ border: 0, borderTop: `1px solid ${BRAND.border}`, margin: "22px 0" }} />
}

export function formatMoney(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currencyCode.toUpperCase() }).format(amount)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))
}
