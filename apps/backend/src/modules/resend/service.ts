import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import { Resend } from "resend"
import { TEMPLATES, type TemplateName } from "./emails"
import type { ResendOptions } from "./types"

type InjectedDependencies = { logger: Logger }

/**
 * Provider de notification : les emails de la boutique, envoyés par Resend.
 *
 * Le module de notification de Medusa ne fournit ni template ni envoi : il reçoit un nom
 * de template et des données, et les confie au provider du canal. Ici, le nom désigne un
 * composant React rendu en HTML statique — tableaux et styles en ligne — puis remis à
 * Resend.
 *
 * Sans clé API — en développement, ou tant que le domaine d'envoi n'est pas configuré —
 * rien ne part : l'email est rendu, journalisé, et écrit dans `.medusa/emails/` pour
 * être ouvert dans un navigateur. Le circuit complet se vérifie ainsi sans envoyer.
 *
 * Avec une boîte Mailtrap, tout part dans cette boîte de test, Resend ou pas : on relit les
 * emails dans une vraie messagerie — rendu, liens, aperçu — sans écrire à un client.
 */
export default class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "resend"

  protected readonly logger_: Logger
  protected readonly options_: ResendOptions
  protected readonly client_: Resend | null

  constructor({ logger }: InjectedDependencies, options: ResendOptions) {
    super()

    this.logger_ = logger
    this.options_ = options
    this.client_ = options.apiKey ? new Resend(options.apiKey) : null

    if (options.mailtrap) {
      // Une boîte de test en production, c'est des clients qui ne reçoivent plus rien.
      const niveau = process.env.NODE_ENV === "production" ? "error" : "info"
      logger[niveau](`Emails : boîte de test Mailtrap active (${options.mailtrap.inboxId}), aucun email ne part chez les clients.`)
    } else if (!this.client_) {
      logger.warn("Resend : pas de clé API, les emails seront rendus et journalisés sans être envoyés.")
    }
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.from || !options.storefrontUrl) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Le provider Resend a besoin d'un expéditeur (`from`) et de l'URL de la boutique (`storefrontUrl`)."
      )
    }
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const template = TEMPLATES[notification.template as TemplateName]

    if (!template) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Resend : aucun email ne s'appelle « ${notification.template} ».`
      )
    }

    // Les données ont la forme que le subscriber a construite pour ce template ; le
    // registre les type par nom, ici on ne peut que faire confiance à l'appelant.
    const data = (notification.data ?? {}) as never
    const subject = template.subject(data)
    const html = "<!DOCTYPE html>" + renderToStaticMarkup(template.render(data, this.options_.storefrontUrl))

    if (this.options_.mailtrap) {
      return this.envoyerVersMailtrap(this.options_.mailtrap, notification, subject, html)
    }

    if (!this.client_) {
      // En production, pas de fichier : il contiendrait nom, adresse et commande du
      // client sur le disque du serveur. On signale seulement que rien n'est parti.
      if (process.env.NODE_ENV === "production") {
        this.logger_.warn(`Resend (sans clé) : « ${subject} » pour ${notification.to} NON envoyé.`)
        return {}
      }

      const chemin = this.ecrirePourApercu(notification.template, notification.to, subject, html)
      this.logger_.info(`Resend (sans clé) : « ${subject} » pour ${notification.to} → ${chemin}`)
      return {}
    }

    const { data: envoye, error } = await this.client_.emails.send({
      from: notification.from || this.options_.from,
      to: notification.to,
      replyTo: this.options_.replyTo,
      subject,
      html,
    })

    if (error) {
      // Laisser remonter : le module de notification enregistre l'échec, et un envoi qui
      // échoue en silence est un client qui ne reçoit rien sans que personne le sache.
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Resend : ${error.name} — ${error.message}`)
    }

    this.logger_.info(`Resend : « ${subject} » envoyé à ${notification.to} (${envoye?.id ?? "?"}).`)

    return { id: envoye?.id }
  }

  /**
   * Dépôt dans la boîte de test Mailtrap (API « Email Testing »).
   *
   * Mailtrap veut l'expéditeur en deux champs : « Golden Vape <x@y> » est découpé ici.
   */
  private async envoyerVersMailtrap(
    mailtrap: NonNullable<ResendOptions["mailtrap"]>,
    notification: ProviderSendNotificationDTO,
    subject: string,
    html: string
  ): Promise<ProviderSendNotificationResultsDTO> {
    const expediteur = notification.from || this.options_.from
    const [, nom, adresse] = expediteur.match(/^\s*(.*?)\s*<([^>]+)>\s*$/) ?? [null, "", expediteur]

    const reponse = await fetch(`https://sandbox.api.mailtrap.io/api/send/${mailtrap.inboxId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mailtrap.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { email: adresse.trim(), ...(nom ? { name: nom } : {}) },
        to: [{ email: notification.to }],
        ...(this.options_.replyTo ? { reply_to: { email: this.options_.replyTo } } : {}),
        subject,
        html,
        category: notification.template,
      }),
    })

    const corps = (await reponse.json().catch(() => ({}))) as { message_ids?: string[]; errors?: string[] }

    if (!reponse.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Mailtrap : ${reponse.status} — ${(corps.errors ?? []).join(", ") || reponse.statusText}`
      )
    }

    const id = corps.message_ids?.[0]
    this.logger_.info(`Mailtrap : « ${subject} » déposé dans la boîte de test pour ${notification.to} (${id ?? "?"}).`)
    return { id }
  }

  private ecrirePourApercu(template: string, to: string, subject: string, html: string): string {
    const dossier = join(process.cwd(), ".medusa", "emails")
    mkdirSync(dossier, { recursive: true })
    const fichier = join(dossier, `${new Date().toISOString().replace(/[:.]/g, "-")}-${template}.html`)
    writeFileSync(fichier, `<!-- À : ${to}\n     Objet : ${subject} -->\n${html}`)
    return fichier
  }
}
