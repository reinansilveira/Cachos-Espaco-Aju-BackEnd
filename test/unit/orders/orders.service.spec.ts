import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  ProductType,
  StockMovementType,
} from '@prisma/client';
import { OrdersService } from '../../../src/modules/orders/orders.service';
import { makePrismaMock } from '../../mocks/services/prisma.mock';
import { orderRow, productItem, serviceItem } from './order.fixtures';

describe('OrdersService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let stock: { apply: jest.Mock };
  let payments: { cancelPendingForOrder: jest.Mock };
  let service: OrdersService;

  // `lockOrder` lê com items; `findOrThrow` lê com ORDER_INCLUDE.
  const givenOrder = (order: ReturnType<typeof orderRow>) => {
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue(order);
  };

  beforeEach(() => {
    prisma = makePrismaMock();
    stock = { apply: jest.fn().mockResolvedValue({}) };
    payments = { cancelPendingForOrder: jest.fn().mockResolvedValue(undefined) };
    service = new OrdersService(prisma as any, stock as any, payments as any);
    prisma.orderPayment.findFirst.mockResolvedValue(null);
    prisma.orderPayment.findMany.mockResolvedValue([]);
  });

  describe('create', () => {
    it('abre a comanda do atendimento com o serviço e o preço do agendamento', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        clientId: 'c1',
        serviceId: 's1',
        professionalId: 'pro1',
        price: 180,
        status: AppointmentStatus.COMPLETED,
        service: { name: 'Corte + hidratação' },
        order: null,
      });
      prisma.order.create.mockResolvedValue(orderRow({ items: [serviceItem()] }));

      await service.create({ appointmentId: 'a1' }, 'u1');

      const data = prisma.order.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        appointmentId: 'a1',
        clientId: 'c1',
        subtotal: 180,
        total: 180,
        openedById: 'u1',
      });
      expect(data.items.create).toMatchObject({
        type: OrderItemType.SERVICE,
        professionalId: 'pro1',
        description: 'Corte + hidratação',
        unitPrice: 180,
      });
    });

    it('não abre segunda comanda para o mesmo atendimento', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: AppointmentStatus.COMPLETED,
        service: {},
        order: { id: 'o-old' },
      });

      await expect(service.create({ appointmentId: 'a1' })).rejects.toThrow(ConflictException);
    });

    it('não abre comanda de agendamento cancelado', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: AppointmentStatus.CANCELLED,
        service: {},
        order: null,
      });

      await expect(service.create({ appointmentId: 'a1' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('addItem', () => {
    const saleProduct = {
      id: 'p1',
      name: 'Creme',
      brand: 'Marca',
      type: ProductType.SALE,
      salePrice: 20,
      stockQuantity: 5,
      active: true,
    };

    it('adiciona produto de venda com preço do catálogo e recalcula o total', async () => {
      givenOrder(orderRow({ items: [serviceItem()] }));
      prisma.product.findUnique.mockResolvedValue(saleProduct);
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        orderRow({ items: [serviceItem(), productItem()] }),
      );

      await service.addItem('o1', { type: OrderItemType.PRODUCT, productId: 'p1', quantity: 3 });

      expect(prisma.orderItem.create.mock.calls[0][0].data).toMatchObject({
        productId: 'p1',
        description: 'Creme (Marca)',
        quantity: 3,
        unitPrice: 20,
        total: 60,
      });
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { subtotal: 210, discount: 0, total: 210 },
      });
    });

    it('soma na linha existente do mesmo produto', async () => {
      givenOrder(orderRow({ items: [productItem({ quantity: 2 })] }));
      prisma.product.findUnique.mockResolvedValue(saleProduct);

      await service.addItem('o1', { type: OrderItemType.PRODUCT, productId: 'p1', quantity: 1 });

      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'i-prod' },
        data: { quantity: 3, total: 60 },
      });
      expect(prisma.orderItem.create).not.toHaveBeenCalled();
    });

    it('recusa quantidade maior que o estoque', async () => {
      givenOrder(orderRow({ items: [productItem({ quantity: 4 })] }));
      prisma.product.findUnique.mockResolvedValue(saleProduct);

      await expect(
        service.addItem('o1', { type: OrderItemType.PRODUCT, productId: 'p1', quantity: 2 }),
      ).rejects.toThrow(ConflictException);
    });

    it('recusa produto de uso interno', async () => {
      givenOrder(orderRow());
      prisma.product.findUnique.mockResolvedValue({
        ...saleProduct,
        type: ProductType.INTERNAL_USE,
        salePrice: null,
      });

      await expect(
        service.addItem('o1', { type: OrderItemType.PRODUCT, productId: 'p1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('usa o preço do profissional para serviço extra', async () => {
      givenOrder(orderRow());
      prisma.service.findUnique.mockResolvedValue({ id: 's2', name: 'Fitagem', price: 80, active: true });
      prisma.professionalService.findUnique.mockResolvedValue({ customPrice: 95 });

      await service.addItem('o1', {
        type: OrderItemType.SERVICE,
        serviceId: 's2',
        professionalId: 'pro1',
      });

      expect(prisma.orderItem.create.mock.calls[0][0].data).toMatchObject({
        type: OrderItemType.SERVICE,
        unitPrice: 95,
        total: 95,
      });
    });

    it('não altera comanda fechada', async () => {
      givenOrder(orderRow({ status: OrderStatus.AWAITING_PAYMENT }));

      await expect(
        service.addItem('o1', { type: OrderItemType.PRODUCT, productId: 'p1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('close', () => {
    it('baixa o estoque por produto e aguarda pagamento', async () => {
      givenOrder(
        orderRow({
          items: [serviceItem(), productItem({ quantity: 3 }), productItem({ id: 'i2', productId: 'p2', quantity: 1 })],
        }),
      );

      await service.close('o1', 'u1');

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(stock.apply).toHaveBeenCalledTimes(2);
      expect(stock.apply).toHaveBeenCalledWith(prisma, {
        productId: 'p1',
        type: StockMovementType.SALE,
        delta: -3,
        orderId: 'o1',
        userId: 'u1',
        reason: 'Venda na comanda #7',
      });
      expect(prisma.order.update.mock.calls[0][0].data).toMatchObject({
        status: OrderStatus.AWAITING_PAYMENT,
        subtotal: 230,
        total: 230,
        paidAt: null,
      });
    });

    it('comanda zerada já sai paga', async () => {
      givenOrder(orderRow({ items: [serviceItem({ unitPrice: 0, total: 0 })] }));

      await service.close('o1');

      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(OrderStatus.PAID);
    });

    it('sinal que cobre o total já fecha como paga', async () => {
      givenOrder(orderRow({ items: [serviceItem({ unitPrice: 50, total: 50 })] }));
      prisma.orderPayment.findMany.mockResolvedValue([
        { status: PaymentStatus.PAID, amount: 50, isDeposit: true },
      ]);

      await service.close('o1');

      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(OrderStatus.PAID);
    });

    it('não fecha comanda vazia', async () => {
      givenOrder(orderRow());

      await expect(service.close('o1')).rejects.toThrow(BadRequestException);
    });

    it('propaga falta de estoque no fechamento', async () => {
      givenOrder(orderRow({ items: [productItem()] }));
      stock.apply.mockRejectedValue(new ConflictException('Estoque insuficiente'));

      await expect(service.close('o1')).rejects.toThrow(ConflictException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel e reopen', () => {
    it('cancelar comanda fechada devolve os produtos', async () => {
      givenOrder(orderRow({ status: OrderStatus.AWAITING_PAYMENT, items: [productItem({ quantity: 2 })] }));

      await service.cancel('o1', 'Desistiu', 'u1');

      expect(payments.cancelPendingForOrder).toHaveBeenCalledWith('o1');
      expect(stock.apply).toHaveBeenCalledWith(prisma, {
        productId: 'p1',
        type: StockMovementType.RETURN,
        delta: 2,
        orderId: 'o1',
        userId: 'u1',
        reason: 'Comanda cancelada (#7)',
      });
      expect(prisma.order.update.mock.calls[0][0].data).toMatchObject({
        status: OrderStatus.CANCELLED,
        cancelReason: 'Desistiu',
      });
    });

    it('cancelar comanda aberta não mexe no estoque', async () => {
      givenOrder(orderRow({ items: [productItem()] }));

      await service.cancel('o1');

      expect(stock.apply).not.toHaveBeenCalled();
    });

    it('não cancela comanda paga', async () => {
      givenOrder(orderRow({ status: OrderStatus.PAID }));

      await expect(service.cancel('o1')).rejects.toThrow(ConflictException);
    });

    it('o sinal pago não impede reabrir a comanda', async () => {
      givenOrder(orderRow({ status: OrderStatus.AWAITING_PAYMENT, items: [productItem()] }));

      await service.reopen('o1');

      expect(prisma.orderPayment.findFirst.mock.calls[0][0].where.isDeposit).toBe(false);
    });

    it('não reabre comanda com pagamento confirmado', async () => {
      givenOrder(orderRow({ status: OrderStatus.AWAITING_PAYMENT, items: [productItem()] }));
      prisma.orderPayment.findFirst.mockResolvedValue({ status: PaymentStatus.PAID });

      await expect(service.reopen('o1')).rejects.toThrow(ConflictException);
      expect(stock.apply).not.toHaveBeenCalled();
    });

    it('reabrir devolve o estoque e volta para OPEN', async () => {
      givenOrder(orderRow({ status: OrderStatus.AWAITING_PAYMENT, items: [productItem()] }));

      await service.reopen('o1');

      expect(stock.apply).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: StockMovementType.RETURN, delta: 3 }),
      );
      expect(prisma.order.update.mock.calls[0][0].data).toEqual({
        status: OrderStatus.OPEN,
        closedAt: null,
      });
    });
  });

  it('comanda inexistente', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.findById('x')).rejects.toThrow(NotFoundException);
  });

  it('desconto maior que o subtotal é recusado', async () => {
    givenOrder(orderRow({ items: [serviceItem()] }));

    await expect(service.update('o1', { discount: 500 })).rejects.toThrow(BadRequestException);
  });

  it('desconto grava subtotal, desconto e total juntos', async () => {
    givenOrder(orderRow({ items: [serviceItem(), productItem()] }));

    await service.update('o1', { discount: 10 });

    expect(prisma.order.update.mock.calls[0][0].data).toMatchObject({
      subtotal: 210,
      discount: 10,
      total: 200,
    });
  });

  it('busca clientes por nome ou telefone', async () => {
    prisma.client.findMany.mockResolvedValue([
      { id: 'c1', cpfCnpj: '1', user: { name: 'Maria', phone: '79999990000' } },
    ]);

    const result = await service.searchClients('(79) 9999');

    expect(prisma.client.findMany.mock.calls[0][0].where.user.OR).toEqual([
      { name: { contains: '(79) 9999', mode: 'insensitive' } },
      { phone: { contains: '799999' } },
    ]);
    expect(result).toEqual([{ id: 'c1', name: 'Maria', phone: '79999990000', hasCpf: true }]);
  });

  it('troca a cliente com a comanda aguardando pagamento', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'c2' });
    prisma.order.findUnique.mockResolvedValue(orderRow({ status: OrderStatus.AWAITING_PAYMENT }));
    prisma.order.update.mockResolvedValue(orderRow({ status: OrderStatus.AWAITING_PAYMENT }));

    await service.update('o1', { clientId: 'c2' });

    expect(prisma.order.update.mock.calls[0][0].data).toEqual({ clientId: 'c2', notes: undefined });
  });

  it('não troca a cliente de comanda paga', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'c2' });
    prisma.order.findUnique.mockResolvedValue(orderRow({ status: OrderStatus.PAID }));

    await expect(service.update('o1', { clientId: 'c2' })).rejects.toThrow(ConflictException);
  });
});
