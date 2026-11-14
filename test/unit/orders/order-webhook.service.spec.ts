import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { OrderWebhookService } from '../../../src/modules/orders/order-webhook.service';
import { parseAsaasWebhook } from '../../../src/modules/payment-gateway/asaas/asaas-webhook.parser';
import { asaasEvent } from '../../fixtures/asaas/webhooks';
import { makePrismaMock } from '../../mocks/services/prisma.mock';

describe('OrderWebhookService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let payments: { applyGatewayStatus: jest.Mock; markDeleted: jest.Mock };
  let gateway: { provider: string; isValidWebhookToken: jest.Mock; parseWebhook: jest.Mock };
  let service: OrderWebhookService;

  beforeEach(() => {
    prisma = makePrismaMock();
    payments = { applyGatewayStatus: jest.fn(), markDeleted: jest.fn() };
    gateway = {
      provider: 'asaas',
      isValidWebhookToken: jest.fn().mockReturnValue(true),
      parseWebhook: jest.fn(parseAsaasWebhook),
    };
    service = new OrderWebhookService(prisma as any, payments as any, gateway as any);
    prisma.orderPayment.findUnique.mockResolvedValue(null);
  });

  it('recusa token inválido', async () => {
    gateway.isValidWebhookToken.mockReturnValue(false);

    await expect(service.handle('x', asaasEvent('PAYMENT_RECEIVED'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa payload inválido', async () => {
    await expect(service.handle('ok', { foo: 1 })).rejects.toThrow(BadRequestException);
  });

  it('pagamento recebido acha a cobrança pelo id do Asaas e aplica o status', async () => {
    prisma.orderPayment.findUnique.mockResolvedValueOnce({ id: 'op1' });

    const result = await service.handle(
      'ok',
      asaasEvent('PAYMENT_RECEIVED', { status: 'RECEIVED', confirmedDate: '2026-11-13' }),
    );

    expect(prisma.gatewayWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'evt_PAYMENT_RECEIVED_0001', provider: 'asaas' }),
    });
    expect(payments.applyGatewayStatus).toHaveBeenCalledWith(
      prisma,
      'op1',
      expect.objectContaining({ id: 'pay_0001', status: 'PAID', paidAt: '2026-11-13' }),
    );
    expect(result).toEqual({ received: true, duplicate: false });
  });

  it('acha a cobrança pela referência externa quando o id ainda não foi gravado', async () => {
    prisma.orderPayment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pay-local-1' });

    await service.handle('ok', asaasEvent('PAYMENT_CONFIRMED', { status: 'CONFIRMED' }));

    expect(prisma.orderPayment.findUnique).toHaveBeenLastCalledWith({
      where: { id: 'pay-local-1' },
      select: { id: true },
    });
    expect(payments.applyGatewayStatus).toHaveBeenCalledWith(prisma, 'pay-local-1', expect.anything());
  });

  it('cobrança excluída no Asaas é cancelada aqui', async () => {
    prisma.orderPayment.findUnique.mockResolvedValueOnce({ id: 'op1' });

    await service.handle('ok', asaasEvent('PAYMENT_DELETED'));

    expect(payments.markDeleted).toHaveBeenCalledWith(prisma, 'op1');
    expect(payments.applyGatewayStatus).not.toHaveBeenCalled();
  });

  it('cobrança desconhecida só é registrada', async () => {
    await service.handle('ok', asaasEvent('PAYMENT_RECEIVED', { externalReference: null }));

    expect(payments.applyGatewayStatus).not.toHaveBeenCalled();
    expect(prisma.gatewayWebhookEvent.create).toHaveBeenCalled();
  });

  it('evento repetido é ignorado', async () => {
    prisma.gatewayWebhookEvent.create.mockRejectedValue(
      new PrismaClientKnownRequestError('duplicado', { code: 'P2002', clientVersion: '5' }),
    );

    const result = await service.handle('ok', asaasEvent('PAYMENT_RECEIVED'));

    expect(result).toEqual({ received: true, duplicate: true });
    expect(payments.applyGatewayStatus).not.toHaveBeenCalled();
  });
});
