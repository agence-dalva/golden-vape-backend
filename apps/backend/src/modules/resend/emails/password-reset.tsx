import { Button, Layout, Paragraph, Title } from "./layout"

export type PasswordResetData = {
  reset_url: string
}

export function passwordResetSubject(): string {
  return "Réinitialisation de votre mot de passe"
}

export function PasswordResetEmail({ data, storefrontUrl }: { data: PasswordResetData; storefrontUrl: string }) {
  return (
    <Layout preview="Choisissez un nouveau mot de passe pour votre compte Golden Vape." storefrontUrl={storefrontUrl}>
      <Title>Nouveau mot de passe</Title>
      <Paragraph>
        Vous avez demandé à réinitialiser le mot de passe de votre compte. Cliquez sur le bouton
        ci-dessous pour en choisir un nouveau.
      </Paragraph>
      <Button href={data.reset_url}>Choisir un nouveau mot de passe</Button>
      <Paragraph muted>
        Ce lien est valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez
        cet email : votre mot de passe reste inchangé.
      </Paragraph>
    </Layout>
  )
}
