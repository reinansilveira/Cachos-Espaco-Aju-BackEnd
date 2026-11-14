import {
  mapAsaasPaymentStatus,
  parseAsaasWebhook,
} from '../../../src/modules/payment-gateway/asaas/asaas-webhook.parser';
import { asaasEvent } from '../../fixtures/asaas/webhooks';

describe('parseAsaasWebhook', () => {
  it.each([
    ['PAYMENT_RECEIVED', 'PAYMENT_PAID'],
    ['PAYMENT_CONFIRMED', 'PAYMENT_PAID'],
    ['PAYMENT_OVERDUE', 'PAYMENT_OVERDUE'],
    ['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PAYMENT_FAILED'],
    ['PAYMENT_REFUNDED', 'PAYMENT_REFUNDED'],
    ['PAYMENT_DELETED', 'PAYMENT_DELETED'],
    ['PAYMENT_BANK_SLIP_VIEWED', 'IGNORED'],
  ])('traduz %s para %s', (raw, expected) => {
    expect(parseAsaasWebhook(asaasEvent(raw)).type).toBe(expected);
  });

  it('mapeia a cobrança', () => {
    const event = parseAsaasWebhook(
      asaasEvent('PAYMENT_RECEIVED', { status: 'RECEIVED', paymentDate: '2026-11-13', billingType: 'BOLETO' }),
    );

    expect(event.payment).toEqual({
      id: 'pay_0001',
      externalReference: 'order-payment:pay-local-1',
      value: 99.9,
      status: 'PAID',
      billingType: null,
      dueDate: '2026-11-02',
      paidAt: '2026-11-13',
      invoiceUrl: 'https://sandbox.asaas.com/i/0001',
    });
  });

  it('recusa payload sem id ou evento', () => {
    expect(() => parseAsaasWebhook({ event: 'PAYMENT_RECEIVED' })).toThrow();
  });

  it.each([
    ['RECEIVED_IN_CASH', 'PAID'],
    ['REFUND_IN_PROGRESS', 'REFUNDED'],
    ['OVERDUE', 'OVERDUE'],
    ['AWAITING_RISK_ANALYSIS', 'PENDING'],
  ])('status %s vira %s', (raw, expected) => {
    expect(mapAsaasPaymentStatus(raw)).toBe(expected);
  });
});
