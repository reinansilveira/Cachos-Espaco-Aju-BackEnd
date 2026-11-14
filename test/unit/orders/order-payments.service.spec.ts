import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  OrderPaymentsService,
  paidAtFrom,
} from '../../../src/modules/orders/order-payments.service';
import { GatewayPayment } from '../../../src/modules/payment-gateway/payment-gateway.types';
import { makePrismaMock } from '../../mocks/services/prisma.mock';

const CPF = '529.982.247-25';

const charge = (overrides: Partial<GatewayPayment> = {}): GatewayPayment => ({
  id: 'pay_1',
  externalReference: null,
  value: 210,
  status: 'PENDING',
  billingType: 'PIX',
  dueDate: '2026-11-13',
  paidAt: null,
  invoiceUrl: 'https://sandbox.asaas.com/i/1',
  ...overrides,
});

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'op1',
  orderId: 'o1',
  method: PaymentMethod.PIX,
  gateway: true,
  status: PaymentStatus.PENDING,
  amount: 210,
  gatewayPaymentId: 'pay_1',
  invoiceUrl: null,
  pixPayload: null,
  dueDate: null,
  paidAt: null,
  refundedAt: null,
  notes: null,
  createdById: null,
  isDeposit: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('OrderPaymentsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let gateway: Record<string, jest.Mock>;
  let service: OrderPaymentsService;

  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 'o1',
    number: 7,
    status: OrderStatus.AWAITING_PAYMENT,
    total: 210,
    payments: [],
    client: {
      id: 'c1',
      cpfCnpj: null,
      gatewayCustomerId: null,
      user: { name: 'Maria', email: 'maria@ex.com', phone: '79999990000' },
    },
    ...overrides,
  });

  beforeEach(() => {
    prisma = makePrismaMock();
    gateway = {
      createCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
      createCharge: jest.fn().mockResolvedValue(charge()),
      getCharge: jest.fn(),
      cancelCharge: jest.fn().mockResolvedValue(undefined),
      getPixQrCode: jest
        .fn()
        .mockResolvedValue({ payload: 'pix-copia-e-cola', encodedImage: 'iVBOR', expirationDate: null }),
    };
    service = new OrderPaymentsService(prisma as any, gateway as any);
    prisma.orderPayment.findMany.mockResolvedValue([]);
    prisma.orderPayment.create.mockImplementation(({ data }: any) => paymentRow(data));
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('pagamento manual', () => {
    it('maquininha registra pago e quita a comanda', async () => {
      prisma.order.findUnique.mockResolvedValue(order());

      const result = await service.create('o1', { method: PaymentMethod.DEBIT_CARD }, 'u1');

      expect(prisma.orderPayment.create.mock.calls[0][0].data).toMatchObject({
        method: PaymentMethod.DEBIT_CARD,
        gateway: false,
        status: PaymentStatus.PAID,
        amount: 210,
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', status: OrderStatus.AWAITING_PAYMENT },
        data: { status: OrderStatus.PAID, paidAt: expect.any(Date) },
      });
      expect(gateway.createCharge).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PAID);
    });

    it('exige comanda fechada', async () => {
      prisma.order.findUnique.mockResolvedValue(order({ status: OrderStatus.OPEN }));

      await expect(service.create('o1', { method: PaymentMethod.CASH })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cobrança no Asaas', () => {
    it('Pix cria cliente com CPF, gera a cobrança e devolve o QR', async () => {
      prisma.order.findUnique.mockResolvedValue(order());

      const result = await service.create(
        'o1',
        { method: PaymentMethod.PIX, gateway: true, cpfCnpj: CPF },
        'u1',
      );

      expect(gateway.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ cpfCnpj: '52998224725', externalReference: 'c1' }),
      );
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { cpfCnpj: '52998224725', gatewayCustomerId: 'cus_1' },
      });
      const input = gateway.createCharge.mock.calls[0][0];
      expect(input).toMatchObject({ customerId: 'cus_1', billingType: 'PIX', value: 210 });
      expect(input.externalReference).toMatch(/^order-payment:/);
      expect(input.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(prisma.orderPayment.create.mock.calls[0][0].data).toMatchObject({
        id: input.externalReference.replace('order-payment:', ''),
        gateway: true,
        status: PaymentStatus.PENDING,
        gatewayPaymentId: 'pay_1',
        pixPayload: 'pix-copia-e-cola',
      });
      expect(result.pixQrCodeImage).toBe('iVBOR');
    });

    it('reaproveita o cliente já cadastrado no Asaas', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order({
          client: {
            id: 'c1',
            cpfCnpj: '52998224725',
            gatewayCustomerId: 'cus_old',
            user: { name: 'Maria', email: null, phone: null },
          },
        }),
      );

      await service.create('o1', { method: PaymentMethod.CREDIT_CARD, gateway: true });

      expect(gateway.createCustomer).not.toHaveBeenCalled();
      expect(gateway.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_old', billingType: 'CREDIT_CARD' }),
      );
      expect(gateway.getPixQrCode).not.toHaveBeenCalled();
    });

    it('sem CPF não gera cobrança', async () => {
      prisma.order.findUnique.mockResolvedValue(order());

      await expect(
        service.create('o1', { method: PaymentMethod.PIX, gateway: true }),
      ).rejects.toThrow(BadRequestException);
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('débito não passa pelo Asaas', async () => {
      prisma.order.findUnique.mockResolvedValue(order());

      await expect(
        service.create('o1', { method: PaymentMethod.DEBIT_CARD, gateway: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('comanda sem cliente não gera cobrança', async () => {
      prisma.order.findUnique.mockResolvedValue(order({ client: null }));

      await expect(
        service.create('o1', { method: PaymentMethod.PIX, gateway: true, cpfCnpj: CPF }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancela a cobrança anterior pendente ao trocar a forma', async () => {
      prisma.order.findUnique.mockResolvedValue(order());
      prisma.orderPayment.findMany.mockResolvedValue([paymentRow()]);
      prisma.orderPayment.findUnique.mockResolvedValue(paymentRow());
      prisma.orderPayment.update.mockResolvedValue(paymentRow({ status: PaymentStatus.CANCELLED }));

      await service.create('o1', { method: PaymentMethod.CASH });

      expect(gateway.cancelCharge).toHaveBeenCalledWith('pay_1');
      expect(prisma.orderPayment.update).toHaveBeenCalledWith({
        where: { id: 'op1' },
        data: { status: PaymentStatus.CANCELLED },
      });
    });

    it('cancela a cobrança no Asaas se o registro local falhar', async () => {
      prisma.order.findUnique.mockResolvedValue(order());
      prisma.orderPayment.create.mockRejectedValue(new Error('db fora'));

      await expect(
        service.create('o1', { method: PaymentMethod.PIX, gateway: true, cpfCnpj: CPF }),
      ).rejects.toThrow('db fora');
      expect(gateway.cancelCharge).toHaveBeenCalledWith('pay_1');
    });

    it('QR indisponível não impede a cobrança', async () => {
      prisma.order.findUnique.mockResolvedValue(order());
      gateway.getPixQrCode.mockRejectedValue(new Error('ainda não gerado'));

      const result = await service.create('o1', {
        method: PaymentMethod.PIX,
        gateway: true,
        cpfCnpj: CPF,
      });

      expect(result.pixQrCodeImage).toBeNull();
    });
  });

  describe('com sinal pago no agendamento', () => {
    const deposit = paymentRow({ status: PaymentStatus.PAID, amount: 30, isDeposit: true });

    it('cobra só o saldo na maquininha', async () => {
      prisma.order.findUnique.mockResolvedValue(order({ payments: [deposit] }));

      await service.create('o1', { method: PaymentMethod.CASH });

      expect(prisma.orderPayment.create.mock.calls[0][0].data.amount).toBe(180);
    });

    it('gera o Pix só do saldo', async () => {
      prisma.order.findUnique.mockResolvedValue(order({ payments: [deposit] }));

      await service.create('o1', { method: PaymentMethod.PIX, gateway: true, cpfCnpj: CPF });

      expect(gateway.createCharge.mock.calls[0][0].value).toBe(180);
    });

    it('recusa cobrar comanda já quitada', async () => {
      prisma.order.findUnique.mockResolvedValue(
        order({ payments: [paymentRow({ status: PaymentStatus.PAID, amount: 210 })] }),
      );

      await expect(service.create('o1', { method: PaymentMethod.CASH })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('applyGatewayStatus', () => {
    it('sinal pago confirma o agendamento e não quita a comanda', async () => {
      prisma.orderPayment.findUniqueOrThrow.mockResolvedValue(paymentRow({ isDeposit: true }));
      prisma.orderPayment.update.mockResolvedValue(paymentRow({ status: PaymentStatus.PAID }));
      prisma.order.findUnique.mockResolvedValue({ appointmentId: 'a1' });

      await service.applyGatewayStatus(prisma as any, 'op1', charge({ status: 'PAID' }));

      expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('pago quita pagamento e comanda', async () => {
      prisma.orderPayment.findUniqueOrThrow.mockResolvedValue(paymentRow());
      prisma.orderPayment.update.mockResolvedValue(paymentRow({ status: PaymentStatus.PAID }));

      await service.applyGatewayStatus(prisma as any, 'op1', charge({ status: 'PAID', paidAt: '2026-11-10' }));

      const paidAt = new Date('2026-11-10T15:00:00Z');
      expect(prisma.orderPayment.update).toHaveBeenCalledWith({
        where: { id: 'op1' },
        data: { status: PaymentStatus.PAID, paidAt },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', status: OrderStatus.AWAITING_PAYMENT },
        data: { status: OrderStatus.PAID, paidAt },
      });
    });

    it('pago repetido não reaplica', async () => {
      prisma.orderPayment.findUniqueOrThrow.mockResolvedValue(paymentRow({ status: PaymentStatus.PAID }));

      await service.applyGatewayStatus(prisma as any, 'op1', charge({ status: 'PAID' }));

      expect(prisma.orderPayment.update).not.toHaveBeenCalled();
    });

    it('estorno reabre a cobrança da comanda', async () => {
      prisma.orderPayment.findUniqueOrThrow.mockResolvedValue(paymentRow({ status: PaymentStatus.PAID }));

      await service.applyGatewayStatus(prisma as any, 'op1', charge({ status: 'REFUNDED' }));

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', status: OrderStatus.PAID },
        data: { status: OrderStatus.AWAITING_PAYMENT, paidAt: null },
      });
    });

    it.each(['OVERDUE', 'FAILED'] as const)('%s marca o pagamento como falho', async (status) => {
      prisma.orderPayment.findUniqueOrThrow.mockResolvedValue(paymentRow());

      await service.applyGatewayStatus(prisma as any, 'op1', charge({ status }));

      expect(prisma.orderPayment.update).toHaveBeenCalledWith({
        where: { id: 'op1' },
        data: { status: PaymentStatus.FAILED },
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  it('só cancela cobrança pendente', async () => {
    prisma.orderPayment.findUnique.mockResolvedValue(paymentRow({ status: PaymentStatus.PAID }));

    await expect(service.cancel('op1')).rejects.toThrow(ConflictException);
  });
});

describe('paidAtFrom', () => {
  afterEach(() => jest.useRealTimers());

  it('data de hoje vira o momento atual, não a meia-noite UTC', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-13T18:30:00Z'));
    expect(paidAtFrom('2026-11-13')).toEqual(new Date('2026-11-13T18:30:00Z'));
  });

  it('data antiga vira meio-dia em Aracaju', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-13T18:30:00Z'));
    expect(paidAtFrom('2026-11-10')).toEqual(new Date('2026-11-10T15:00:00Z'));
  });

  it('data com hora é usada como veio', () => {
    expect(paidAtFrom('2026-11-13T10:00:00Z')).toEqual(new Date('2026-11-13T10:00:00Z'));
  });
});
