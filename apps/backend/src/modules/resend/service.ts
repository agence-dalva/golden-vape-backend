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

    if (!this.client_) {
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

    if (!this.client_) {
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

  private ecrirePourApercu(template: string, to: string, subject: string, html: string): string {
    const dossier = join(process.cwd(), ".medusa", "emails")
    mkdirSync(dossier, { recursive: true })
    const fichier = join(dossier, `${new Date().toISOString().replace(/[:.]/g, "-")}-${template}.html`)
    writeFileSync(fichier, `<!-- À : ${to}\n     Objet : ${subject} -->\n${html}`)
    return fichier
  }
}
