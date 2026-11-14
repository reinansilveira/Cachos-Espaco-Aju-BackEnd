// Payloads no formato enviado pelo Asaas (API v3), reduzidos aos campos que
// o sistema lê. Usados para testar o webhook sem chave de sandbox.
export const asaasPayment = (overrides: Record<string, unknown> = {}) => ({
  object: 'payment',
  id: 'pay_0001',
  customer: 'cus_0001',
  value: 99.9,
  netValue: 97.91,
  billingType: 'PIX',
  status: 'PENDING',
  dueDate: '2026-11-02',
  paymentDate: null,
  clientPaymentDate: null,
  confirmedDate: null,
  invoiceUrl: 'https://sandbox.asaas.com/i/0001',
  externalReference: 'order-payment:pay-local-1',
  ...overrides,
});

export const asaasEvent = (
  event: string,
  payment: Record<string, unknown> = {},
  id = `evt_${event}_0001`,
) => ({
  id,
  event,
  dateCreated: '2026-11-02 10:00:00',
  payment: asaasPayment(payment),
});
