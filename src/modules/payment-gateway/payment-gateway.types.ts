export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

// Formas que o salão cobra pelo gateway. Maquininha e dinheiro não passam aqui.
export type GatewayBillingType = 'PIX' | 'CREDIT_CARD';

export type GatewayCustomerInput = {
  name: string;
  cpfCnpj: string;
  email?: string | null;
  phone?: string | null;
  externalReference: string;
};

export type GatewayChargeInput = {
  customerId: string;
  billingType: GatewayBillingType;
  value: number;
  // AAAA-MM-DD
  dueDate: string;
  description: string;
  externalReference: string;
};

export type GatewayPaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'FAILED';

export type GatewayPayment = {
  id: string;
  externalReference: string | null;
  value: number;
  status: GatewayPaymentStatus;
  billingType: GatewayBillingType | null;
  dueDate: string;
  paidAt: string | null;
  invoiceUrl: string | null;
};

export type GatewayPixQrCode = {
  // Código "copia e cola" e a imagem do QR em base64 (PNG).
  payload: string;
  encodedImage: string | null;
  expirationDate: string | null;
};

export type GatewayEventType =
  | 'PAYMENT_CREATED'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_PAID'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_DELETED'
  | 'IGNORED';

export type GatewayWebhookEvent = {
  eventId: string;
  rawType: string;
  type: GatewayEventType;
  payment: GatewayPayment | null;
};

// Contrato que qualquer gateway (Asaas, Mercado Pago, Pagar.me) precisa
// cumprir. Os serviços de domínio dependem só desta interface.
export interface PaymentGateway {
  readonly provider: string;
  createCustomer(input: GatewayCustomerInput): Promise<{ id: string }>;
  createCharge(input: GatewayChargeInput): Promise<GatewayPayment>;
  getCharge(chargeId: string): Promise<GatewayPayment>;
  cancelCharge(chargeId: string): Promise<void>;
  getPixQrCode(chargeId: string): Promise<GatewayPixQrCode>;
  isValidWebhookToken(token: string | undefined): boolean;
  parseWebhook(payload: unknown): GatewayWebhookEvent;
}
