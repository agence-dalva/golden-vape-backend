import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { toOperationalKey } from "./lib/seal"
import type { MoneticoOptions } from "./types"

/** Codes de l'interface « Retour » qui valent paiement accepté. */
export const ACCEPTED_RETURN_CODES = ["paiement", "payetest"]

/** Confirmation déposée sur la session par l'interface « Retour ». */
export type MoneticoConfirmation = {
  code_retour: string
  reference: string
  montant: string
  numauto?: string
  brand?: string
  cbmasquee?: string
  date?: string
  confirmed_at: string
}

export type MoneticoSessionData = {
  session_id?: string
  reference?: string
  monetico?: MoneticoConfirmation
}

/**
 * Référence de commande transmise à Monetico. Le format autorisé va jusqu'à 50
 * caractères, mais la documentation recommande 12 caractères alphanumériques au plus
 * pour que la référence reste lisible dans les remises bancaires — on prend donc la
 * fin de l'identifiant de session, qui est un ULID et donc déjà alphanumérique.
 *
 * Elle est déterministe : une nouvelle tentative de paiement sur la même session
 * réutilise la même référence, ce que Monetico autorise après un refus.
 */
export function buildReference(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-12)
}

type InjectedDependencies = {
  logger: Logger
}

export default class MoneticoProviderService extends AbstractPaymentProvider<MoneticoOptions> {
  static identifier = "monetico"

  protected readonly logger_: Logger

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of ["tpe", "societe", "key", "urlRetourOk", "urlRetourErr"]) {
      if (!options[key]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          `L'option « ${key} » est requise par le provider de paiement Monetico.`
        )
      }
    }

    if (!/^[A-Za-z0-9]{7}$/.test(String(options.tpe))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Le numéro de TPE Monetico doit faire 7 caractères alphanumériques."
      )
    }

    // Lève si la clé n'est pas une chaîne de 40 caractères hexadécimaux.
    toOperationalKey(String(options.key))
  }

  constructor(container: InjectedDependencies, options: MoneticoOptions) {
    super(container, options)
    this.logger_ = container.logger
  }

  get options(): MoneticoOptions {
    return this.config
  }

  /**
   * La page de paiement n'est pas construite ici : le formulaire scellé a besoin des
   * adresses et du panier, que le conteneur du module de paiement ne permet pas
   * d'atteindre. Il est produit par `POST /store/monetico/payment-form`, qui lit la
   * référence posée ci-dessous.
   */
  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = input.data?.session_id as string | undefined

    if (!sessionId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Le module de paiement n'a pas transmis d'identifiant de session à Monetico."
      )
    }

    return {
      id: buildReference(sessionId),
      status: PaymentSessionStatus.PENDING,
      data: {
        session_id: sessionId,
        reference: buildReference(sessionId),
      },
    }
  }

  /**
   * Appelé par la finalisation du panier. La confirmation vient exclusivement de
   * l'interface « Retour » de Monetico, dont le sceau a été vérifié : sans elle on
   * renvoie un statut non autorisé, ce qui fait échouer la finalisation du panier.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return {
      data: input.data ?? {},
      status: this.statusFromData(input.data),
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    return {
      data: input.data ?? {},
      status: this.statusFromData(input.data),
    }
  }

  private statusFromData(data?: Record<string, unknown>): PaymentSessionStatus {
    const confirmation = (data as MoneticoSessionData | undefined)?.monetico

    if (!confirmation) {
      return PaymentSessionStatus.PENDING
    }

    if (!ACCEPTED_RETURN_CODES.includes(confirmation.code_retour)) {
      return PaymentSessionStatus.ERROR
    }

    // Un TPE en paiement immédiat — le paramétrage par défaut — encaisse au moment de
    // l'autorisation : la session est donc directement encaissée côté Medusa.
    return this.options.deferredCapture
      ? PaymentSessionStatus.AUTHORIZED
      : PaymentSessionStatus.CAPTURED
  }

  /**
   * En paiement immédiat, Monetico a déjà encaissé : la remise est pilotée par la
   * banque et il n'y a rien à demander ici.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data ?? {} }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  /**
   * L'interface « Retour » de Monetico attend un accusé de réception au format texte
   * bien précis, que la route générique des webhooks de Medusa ne sait pas produire :
   * elle est donc traitée par `POST /hooks/monetico`.
   */
  async getWebhookActionAndData(): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }

  /**
   * Le remboursement passe par un service serveur à serveur distinct
   * (`recredit_paiement.cgi`) qui n'est pas encore branché : on refuse explicitement
   * plutôt que de laisser Medusa croire que l'argent est reparti.
   */
  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Le remboursement Monetico n'est pas encore implémenté : il doit être effectué depuis le back-office Monetico."
    )
  }
}
