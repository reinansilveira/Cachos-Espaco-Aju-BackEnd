import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'crypto';
import {
  GatewayChargeInput,
  GatewayCustomerInput,
  GatewayPayment,
  GatewayPixQrCode,
  GatewayWebhookEvent,
  PaymentGateway,
} from '../payment-gateway.types';
import { parseAsaasWebhook } from '../asaas/asaas-webhook.parser';

// Gateway em memória para testar o fluxo localmente sem chave do Asaas.
// Os eventos chegam no formato do Asaas (scripts/simulate-asaas-webhook.js).
@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly provider = 'asaas';
  private readonly logger = new Logger(FakeGateway.name);
  private readonly charges = new Map<string, GatewayPayment>();
  private readonly webhookToken?: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.webhookToken = config.get<string>('ASAAS_WEBHOOK_TOKEN');
    this.frontendUrl =
      config.get<string>('FRONTEND_URL') || 'http://localhost:3011';
  }

  async createCustomer(input: GatewayCustomerInput) {
    this.logger.warn(`[fake] cliente criado para ${input.externalReference}`);
    return { id: `cus_fake_${randomUUID().slice(0, 8)}` };
  }

  async createCharge(input: GatewayChargeInput): Promise<GatewayPayment> {
    const id = `pay_fake_${randomUUID().slice(0, 8)}`;
    const charge: GatewayPayment = {
      id,
      externalReference: input.externalReference,
      value: input.value,
      status: 'PENDING',
      billingType: input.billingType,
      dueDate: input.dueDate,
      paidAt: null,
      invoiceUrl: `${this.frontendUrl}/dashboard?view=comandas&fatura=${id}`,
    };
    this.charges.set(id, charge);
    this.logger.warn(`[fake] cobrança ${id} criada (${input.value})`);
    return charge;
  }

  async getCharge(chargeId: string) {
    const charge = this.charges.get(chargeId);
    if (!charge) throw new NotFoundException('Cobrança não encontrada');
    return charge;
  }

  async cancelCharge(chargeId: string) {
    this.charges.delete(chargeId);
    this.logger.warn(`[fake] cobrança ${chargeId} cancelada`);
  }

  // Sem QR de verdade: o front mostra só o código para copiar.
  async getPixQrCode(chargeId: string): Promise<GatewayPixQrCode> {
    return {
      payload: `00020126580014BR.GOV.BCB.PIX0136fake-${chargeId}5204000053039865802BR`,
      encodedImage: null,
      expirationDate: null,
    };
  }

  isValidWebhookToken(token: string | undefined) {
    if (!this.webhookToken || !token) return false;
    const expected = Buffer.from(this.webhookToken);
    const received = Buffer.from(token);
    return (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    );
  }

  parseWebhook(payload: unknown): GatewayWebhookEvent {
    return parseAsaasWebhook(payload);
  }
}
