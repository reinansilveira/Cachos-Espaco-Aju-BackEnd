import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { DepositService } from '../../../src/modules/orders/deposit.service';
import {
  balanceDue,
  depositAmount,
  paidAmount,
} from '../../../src/modules/orders/rules/payment-balance';
import { makePrismaMock } from '../../mocks/services/prisma.mock';

const CPF = '529.982.247-25';
const future = new Date(Date.now() + 2 * 86_400_000);

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  price: 140,
  status: AppointmentStatus.PENDING,
  scheduledAt: future,
  service: { name: 'Corte' },
  client: { id: 'c1', cpfCnpj: null, gatewayCustomerId: null, user: { name: 'Maria' } },
  ...overrides,
});

describe('regras de saldo', () => {
  it('sinal é 20% arredondado em centavos', () => {
    expect(depositAmount(140)).toBe(28);
    expect(depositAmount(107)).toBe(21.4);
  });

  it('só pagamentos pagos abatem do total', () => {
    const payments = [
      { status: PaymentStatus.PAID, amount: 28 },
      { status: PaymentStatus.CANCELLED, amount: 28 },
    ];
    expect(paidAmount(payments)).toBe(28);
    expect(balanceDue(140, payments)).toBe(112);
    expect(balanceDue(20, payments)).toBe(0);
  });
});

describe('DepositService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let orders: { orderForAppointment: jest.Mock };
  let payments: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock>;
  let service: DepositService;

  beforeEach(() => {
    prisma = makePrismaMock();
    orders = { orderForAppointment: jest.fn().mockResolvedValue({ id: 'o1', payments: [] }) };
    payments = {
      cancelPendingForOrder: jest.fn().mockResolvedValue(undefined),
      customerFor: jest.fn().mockResolvedValue('cus_1'),
      safePixQrCode: jest.fn().mockResolvedValue({ payload: 'pix', encodedImage: 'png' }),
      applyGatewayStatus: jest.fn(),
    };
    gateway = {
      createCharge: jest.fn().mockResolvedValue({
        id: 'pay_1',
        dueDate: '2026-11-13',
        invoiceUrl: 'https://asaas/i/1',
      }),
      cancelCharge: jest.fn().mockResolvedValue(undefined),
      getCharge: jest.fn(),
    };
    service = new DepositService(prisma as any, orders as any, payments as any, gateway as any);
    prisma.appointment.findUnique.mockResolvedValue(appointment());
    prisma.orderPayment.create.mockImplementation(({ data }: any) => ({
      ...data,
      createdAt: new Date(),
      paidAt: null,
      refundedAt: null,
    }));
  });

  it('gera o Pix de 20% na comanda do atendimento', async () => {
    const result = await service.start('a1', { cpfCnpj: CPF, method: 'PIX' });

    expect(orders.orderForAppointment).toHaveBeenCalledWith('a1');
    expect(payments.customerFor).toHaveBeenCalledWith(appointment().client, CPF);
    expect(gateway.createCharge.mock.calls[0][0]).toMatchObject({
      customerId: 'cus_1',
      billingType: 'PIX',
      value: 28,
    });
    expect(prisma.orderPayment.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'o1',
      method: PaymentMethod.PIX,
      isDeposit: true,
      status: PaymentStatus.PENDING,
      amount: 28,
    });
    expect(result.pixQrCodeImage).toBe('png');
  });

  it('cartão gera o link do Asaas sem QR', async () => {
    await service.start('a1', { cpfCnpj: CPF, method: 'CREDIT_CARD' });

    expect(gateway.createCharge.mock.calls[0][0].billingType).toBe('CREDIT_CARD');
    expect(payments.safePixQrCode).not.toHaveBeenCalled();
  });

  it('não cobra sinal duas vezes', async () => {
    orders.orderForAppointment.mockResolvedValue({
      id: 'o1',
      payments: [{ isDeposit: true, status: PaymentStatus.PAID }],
    });

    await expect(service.start('a1', { cpfCnpj: CPF, method: 'PIX' })).rejects.toThrow(
      ConflictException,
    );
  });

  it.each([
    ['cancelado', { status: AppointmentStatus.CANCELLED }],
    ['que já passou', { scheduledAt: new Date(Date.now() - 3600_000) }],
  ])('recusa agendamento %s', async (_label, overrides) => {
    prisma.appointment.findUnique.mockResolvedValue(appointment(overrides));

    await expect(service.start('a1', { cpfCnpj: CPF, method: 'PIX' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cancela a cobrança no Asaas se o registro falhar', async () => {
    prisma.orderPayment.create.mockRejectedValue(new Error('db'));

    await expect(service.start('a1', { cpfCnpj: CPF, method: 'PIX' })).rejects.toThrow('db');
    expect(gateway.cancelCharge).toHaveBeenCalledWith('pay_1');
  });

  describe('status', () => {
    it('confere no Asaas enquanto está pendente', async () => {
      prisma.orderPayment.findFirst.mockResolvedValue({
        id: 'op1',
        status: PaymentStatus.PENDING,
        gatewayPaymentId: 'pay_1',
        amount: 28,
      });
      gateway.getCharge.mockResolvedValue({ status: 'PAID' });
      payments.applyGatewayStatus.mockResolvedValue({
        id: 'op1',
        status: PaymentStatus.PAID,
        amount: 28,
      });

      const result = await service.status('a1', 'op1');

      expect(prisma.orderPayment.findFirst).toHaveBeenCalledWith({
        where: { id: 'op1', isDeposit: true, order: { appointmentId: 'a1' } },
      });
      expect(result).toEqual({ id: 'op1', status: PaymentStatus.PAID, amount: 28 });
    });

    it('sinal de outro agendamento não aparece', async () => {
      prisma.orderPayment.findFirst.mockResolvedValue(null);

      await expect(service.status('a1', 'x')).rejects.toThrow(NotFoundException);
    });
  });
});
