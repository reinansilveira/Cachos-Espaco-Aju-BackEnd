import {
  GatewayBillingType,
  GatewayEventType,
  GatewayPayment,
  GatewayPaymentStatus,
  GatewayWebhookEvent,
} from '../payment-gateway.types';

export type AsaasPayment = {
  id: string;
  externalReference?: string | null;
  value: number;
  status: string;
  billingType?: string | null;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
};

const EVENT_TYPES: Record<string, GatewayEventType> = {
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  PAYMENT_UPDATED: 'PAYMENT_UPDATED',
  PAYMENT_CONFIRMED: 'PAYMENT_PAID',
  PAYMENT_RECEIVED: 'PAYMENT_PAID',
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'PAYMENT_FAILED',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_CHARGEBACK_REQUESTED: 'PAYMENT_REFUNDED',
  PAYMENT_DELETED: 'PAYMENT_DELETED',
};

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const REFUNDED_STATUSES = [
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
];

export function mapAsaasPaymentStatus(status: string): GatewayPaymentStatus {
  if (PAID_STATUSES.includes(status)) return 'PAID';
  if (REFUNDED_STATUSES.includes(status)) return 'REFUNDED';
  if (status === 'OVERDUE') return 'OVERDUE';
  return 'PENDING';
}

export function mapAsaasBillingType(
  billingType?: string | null,
): GatewayBillingType | null {
  if (billingType === 'PIX' || billingType === 'CREDIT_CARD') return billingType;
  return null;
}

export function mapAsaasPayment(payment: AsaasPayment): GatewayPayment {
  return {
    id: payment.id,
    externalReference: payment.externalReference ?? null,
    value: Number(payment.value),
    status: mapAsaasPaymentStatus(payment.status),
    billingType: mapAsaasBillingType(payment.billingType),
    dueDate: payment.dueDate,
    paidAt:
      payment.confirmedDate ??
      payment.clientPaymentDate ??
      payment.paymentDate ??
      null,
    invoiceUrl: payment.invoiceUrl ?? null,
  };
}

export function parseAsaasWebhook(payload: unknown): GatewayWebhookEvent {
  const body = (payload ?? {}) as {
    id?: string;
    event?: string;
    payment?: AsaasPayment;
  };

  if (!body.id || !body.event) {
    throw new Error('Payload de webhook do Asaas inválido');
  }

  return {
    eventId: body.id,
    rawType: body.event,
    type: EVENT_TYPES[body.event] ?? 'IGNORED',
    payment: body.payment?.id ? mapAsaasPayment(body.payment) : null,
  };
}
