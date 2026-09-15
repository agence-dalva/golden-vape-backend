import type { ReactElement } from "react"
import { OrderCanceledEmail, orderCanceledSubject, type OrderCanceledData } from "./order-canceled"
import { OrderPlacedEmail, orderPlacedSubject, type OrderPlacedData } from "./order-placed"
import { PasswordResetEmail, passwordResetSubject, type PasswordResetData } from "./password-reset"
import { ShipmentCreatedEmail, shipmentCreatedSubject, type ShipmentCreatedData } from "./shipment-created"

/**
 * Les emails que la boutique sait envoyer, par nom de template.
 *
 * Le nom est ce que les subscribers passent au module de notification ; les données
 * sont celles qu'ils ont rassemblées — le provider ne va rien chercher lui-même.
 */
export const TEMPLATES = {
  "order-placed": {
    subject: (data: OrderPlacedData) => orderPlacedSubject(data),
    render: (data: OrderPlacedData, storefrontUrl: string): ReactElement => (
      <OrderPlacedEmail data={data} storefrontUrl={storefrontUrl} />
    ),
  },
  "shipment-created": {
    subject: (data: ShipmentCreatedData) => shipmentCreatedSubject(data),
    render: (data: ShipmentCreatedData, storefrontUrl: string): ReactElement => (
      <ShipmentCreatedEmail data={data} storefrontUrl={storefrontUrl} />
    ),
  },
  "order-canceled": {
    subject: (data: OrderCanceledData) => orderCanceledSubject(data),
    render: (data: OrderCanceledData, storefrontUrl: string): ReactElement => (
      <OrderCanceledEmail data={data} storefrontUrl={storefrontUrl} />
    ),
  },
  "password-reset": {
    subject: () => passwordResetSubject(),
    render: (data: PasswordResetData, storefrontUrl: string): ReactElement => (
      <PasswordResetEmail data={data} storefrontUrl={storefrontUrl} />
    ),
  },
}

export type TemplateName = keyof typeof TEMPLATES
export type TemplateData = {
  "order-placed": OrderPlacedData
  "shipment-created": ShipmentCreatedData
  "order-canceled": OrderCanceledData
  "password-reset": PasswordResetData
}
