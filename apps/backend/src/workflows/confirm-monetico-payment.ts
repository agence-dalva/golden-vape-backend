import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import { Modules, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"
import {
  ACCEPTED_RETURN_CODES,
  type MoneticoConfirmation,
} from "../modules/monetico/service"

type ConfirmMoneticoPaymentInput = {
  sessionId: string
  confirmation: MoneticoConfirmation
}

// Dépose sur la session le résultat vérifié de l'interface « Retour ». C'est cette donnée,
// et elle seule, qui autorisera ensuite le provider à valider le paiement.
export const recordMoneticoConfirmationStep = createStep(
  "record-monetico-confirmation",
  async (input: ConfirmMoneticoPaymentInput, { container }) => {
    const paymentModule = container.resolve(Modules.PAYMENT)
    const session = await paymentModule.retrievePaymentSession(input.sessionId)

    await paymentModule.updatePaymentSession({
      id: session.id,
      amount: session.amount,
      currency_code: session.currency_code,
      data: { ...session.data, monetico: input.confirmation },
    })

    return new StepResponse(
      { sessionId: session.id, amount: session.amount },
      { sessionId: session.id, data: session.data, amount: session.amount, currencyCode: session.currency_code }
    )
  },
  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const paymentModule = container.resolve(Modules.PAYMENT)
    await paymentModule.updatePaymentSession({
      id: previous.sessionId,
      amount: previous.amount,
      currency_code: previous.currencyCode,
      data: previous.data,
    })
  }
)

/**
 * Enregistre la notification de Monetico puis, si le paiement est accepté, autorise la
 * session et laisse Medusa finaliser le panier associé.
 */
export const confirmMoneticoPaymentWorkflow = createWorkflow(
  "confirm-monetico-payment",
  (input: ConfirmMoneticoPaymentInput) => {
    const session = recordMoneticoConfirmationStep(input)

    when({ input }, ({ input }) =>
      ACCEPTED_RETURN_CODES.includes(input.confirmation.code_retour)
    ).then(() => {
      processPaymentWorkflow.runAsStep({
        input: {
          action: PaymentActions.AUTHORIZED,
          data: { session_id: session.sessionId, amount: session.amount },
        },
      })
    })

    return new WorkflowResponse(session)
  }
)
