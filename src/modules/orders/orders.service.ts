import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProductType,
  StockMovementType,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { StockService } from '../products/stock.service';
import { AddOrderItemDto, UpdateOrderItemDto } from './dto/add-order-item.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQuery } from './dto/list-orders.query';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ORDER_INCLUDE, mapOrder } from './mappers/order.mapper';
import { OrderPaymentsService } from './order-payments.service';
import { computeTotals, itemTotal, productQuantities } from './rules/order-totals';
import { balanceDue } from './rules/payment-balance';

type Tx = Prisma.TransactionClient;

// Comanda: OPEN (editável) → AWAITING_PAYMENT (fechada, estoque baixado)
// → PAID. Cancelar ou reabrir antes de pagar devolve os produtos ao estoque.
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly payments: OrderPaymentsService,
  ) {}

  async findAll(query: ListOrdersQuery) {
    const search = query.search?.trim();
    const number = search && /^\d+$/.test(search) ? Number(search) : undefined;
    const orders = await this.prisma.order.findMany({
      where: {
        status: query.status,
        appointmentId: query.appointmentId,
        createdAt: {
          gte: query.from ? startOfDay(query.from) : undefined,
          lte: query.to ? endOfDay(query.to) : undefined,
        },
        ...(search && {
          OR: [
            ...(number ? [{ number }] : []),
            { client: { user: { name: { contains: search, mode: 'insensitive' as const } } } },
          ],
        }),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return orders.map(mapOrder);
  }

  async findById(id: string) {
    return mapOrder(await this.findOrThrow(this.prisma, id));
  }

  async create(dto: CreateOrderDto, userId?: string) {
    if (dto.appointmentId) return this.createFromAppointment(dto, userId);

    if (dto.clientId) await this.assertClient(dto.clientId);
    const order = await this.prisma.order.create({
      data: { clientId: dto.clientId, notes: dto.notes, openedById: userId },
      include: ORDER_INCLUDE,
    });
    return mapOrder(order);
  }

  async update(id: string, dto: UpdateOrderDto) {
    if (dto.clientId) await this.assertClient(dto.clientId);

    // Cliente e observação podem mudar até o pagamento (ex.: escolher a
    // cliente na hora de gerar o Pix). Desconto só com a comanda aberta.
    if (dto.discount === undefined) {
      const order = await this.prisma.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Comanda não encontrada');
      if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.AWAITING_PAYMENT) {
        throw new ConflictException('Comanda finalizada não pode ser alterada.');
      }
      const updated = await this.prisma.order.update({
        where: { id },
        data: { clientId: dto.clientId ?? undefined, notes: dto.notes ?? undefined },
        include: ORDER_INCLUDE,
      });
      return mapOrder(updated);
    }

    return this.mutateOpen(id, async (tx, order) => {
      const { subtotal } = computeTotals(order.items);
      if (dto.discount! > subtotal) {
        throw new BadRequestException('Desconto maior que o valor da comanda.');
      }
      // Desconto e totais mudam juntos por causa do CHECK de consistência.
      await tx.order.update({
        where: { id },
        data: {
          clientId: dto.clientId ?? undefined,
          notes: dto.notes ?? undefined,
          ...computeTotals(order.items, dto.discount),
        },
      });
    });
  }

  async addItem(id: string, dto: AddOrderItemDto) {
    return this.mutateOpen(id, async (tx, order) => {
      const quantity = dto.quantity ?? 1;

      if (dto.type === OrderItemType.PRODUCT) {
        const product = await tx.product.findUnique({ where: { id: dto.productId } });
        if (!product || !product.active) {
          throw new NotFoundException('Produto não encontrado');
        }
        if (product.type !== ProductType.SALE || product.salePrice === null) {
          throw new BadRequestException(
            'Produto de uso interno não entra na comanda. Lance a baixa no estoque.',
          );
        }

        const existing = order.items.find((item) => item.productId === product.id);
        const wanted = (existing?.quantity ?? 0) + quantity;
        if (wanted > product.stockQuantity) {
          throw new ConflictException(
            `Estoque insuficiente de ${product.name}: há ${product.stockQuantity}.`,
          );
        }

        if (existing) {
          await tx.orderItem.update({
            where: { id: existing.id },
            data: { quantity: wanted, total: itemTotal(wanted, existing.unitPrice) },
          });
          return;
        }

        await tx.orderItem.create({
          data: {
            orderId: id,
            type: OrderItemType.PRODUCT,
            productId: product.id,
            professionalId: dto.professionalId,
            description: product.brand ? `${product.name} (${product.brand})` : product.name,
            quantity,
            unitPrice: product.salePrice,
            total: itemTotal(quantity, product.salePrice),
          },
        });
        return;
      }

      const service = await tx.service.findUnique({ where: { id: dto.serviceId } });
      if (!service || !service.active) {
        throw new NotFoundException('Serviço não encontrado');
      }
      const custom = dto.professionalId
        ? await tx.professionalService.findUnique({
            where: {
              professionalId_serviceId: {
                professionalId: dto.professionalId,
                serviceId: service.id,
              },
            },
          })
        : null;
      const unitPrice = dto.unitPrice ?? custom?.customPrice ?? service.price;

      await tx.orderItem.create({
        data: {
          orderId: id,
          type: OrderItemType.SERVICE,
          serviceId: service.id,
          professionalId: dto.professionalId,
          description: service.name,
          quantity,
          unitPrice,
          total: itemTotal(quantity, unitPrice),
        },
      });
    });
  }

  async updateItem(id: string, itemId: string, dto: UpdateOrderItemDto) {
    return this.mutateOpen(id, async (tx, order) => {
      const item = order.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new NotFoundException('Item não encontrado na comanda');

      if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (product && dto.quantity > product.stockQuantity) {
          throw new ConflictException(
            `Estoque insuficiente de ${product.name}: há ${product.stockQuantity}.`,
          );
        }
      }

      await tx.orderItem.update({
        where: { id: itemId },
        data: { quantity: dto.quantity, total: itemTotal(dto.quantity, item.unitPrice) },
      });
    });
  }

  async removeItem(id: string, itemId: string) {
    return this.mutateOpen(id, async (tx, order) => {
      if (!order.items.some((item) => item.id === itemId)) {
        throw new NotFoundException('Item não encontrado na comanda');
      }
      await tx.orderItem.delete({ where: { id: itemId } });
    });
  }

  // Fecha a conta: baixa os produtos vendidos e libera o pagamento.
  async close(id: string, userId?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, id);
      if (current.status !== OrderStatus.OPEN) {
        throw new ConflictException('Só uma comanda aberta pode ser fechada.');
      }
      if (current.items.length === 0) {
        throw new BadRequestException('Adicione um serviço ou produto antes de fechar.');
      }

      for (const [productId, quantity] of productQuantities(current.items)) {
        await this.stock.apply(tx, {
          productId,
          type: StockMovementType.SALE,
          delta: -quantity,
          orderId: id,
          userId,
          reason: `Venda na comanda #${current.number}`,
        });
      }

      const totals = computeTotals(current.items, current.discount);
      const now = new Date();
      // Cortesia, ou sinal que já cobre o total: não há o que cobrar.
      const payments = await tx.orderPayment.findMany({ where: { orderId: id } });
      const free = balanceDue(totals.total, payments) === 0;
      await tx.order.update({
        where: { id },
        data: {
          ...totals,
          status: free ? OrderStatus.PAID : OrderStatus.AWAITING_PAYMENT,
          closedAt: now,
          paidAt: free ? now : null,
        },
      });
      return this.findOrThrow(tx, id);
    });
    return mapOrder(order);
  }

  // Volta para edição. Cobranças pendentes são canceladas e o estoque volta.
  async reopen(id: string, userId?: string) {
    await this.payments.cancelPendingForOrder(id);
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, id);
      if (current.status !== OrderStatus.AWAITING_PAYMENT) {
        throw new ConflictException('Só uma comanda aguardando pagamento pode ser reaberta.');
      }
      await this.assertNoActivePayment(tx, id);
      await this.returnStock(tx, current, userId, 'Comanda reaberta');
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.OPEN, closedAt: null },
      });
      return this.findOrThrow(tx, id);
    });
    return mapOrder(order);
  }

  async cancel(id: string, reason?: string, userId?: string) {
    await this.payments.cancelPendingForOrder(id);
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, id);
      if (
        current.status !== OrderStatus.OPEN &&
        current.status !== OrderStatus.AWAITING_PAYMENT
      ) {
        throw new ConflictException('Comanda paga ou já cancelada não pode ser cancelada.');
      }
      await this.assertNoActivePayment(tx, id);
      if (current.status === OrderStatus.AWAITING_PAYMENT) {
        await this.returnStock(tx, current, userId, 'Comanda cancelada');
      }
      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason ?? null,
        },
      });
      return this.findOrThrow(tx, id);
    });
    return mapOrder(order);
  }

  // Busca curta para escolher a cliente da comanda.
  async searchClients(search?: string) {
    const term = search?.trim();
    const digits = term?.replace(/\D/g, '');
    const clients = await this.prisma.client.findMany({
      where: {
        active: true,
        ...(term && {
          user: {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              ...(digits && digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          },
        }),
      },
      include: { user: { select: { name: true, phone: true } } },
      orderBy: { user: { name: 'asc' } },
      take: 10,
    });
    return clients.map((client) => ({
      id: client.id,
      name: client.user.name,
      phone: client.user.phone,
      hasCpf: !!client.cpfCnpj,
    }));
  }

  async summary(from?: string, to?: string) {
    const where: Prisma.OrderWhereInput = {
      status: OrderStatus.PAID,
      paidAt: {
        gte: from ? startOfDay(from) : undefined,
        lte: to ? endOfDay(to) : undefined,
      },
    };

    const [orders, items, payments] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _count: true,
        _sum: { total: true, discount: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['type'],
        where: { order: where },
        _sum: { total: true, quantity: true },
      }),
      this.prisma.orderPayment.groupBy({
        by: ['method'],
        where: { status: PaymentStatus.PAID, order: where },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const byType = (type: OrderItemType) => items.find((row) => row.type === type);
    return {
      orders: orders._count,
      revenue: Number(orders._sum.total ?? 0),
      discounts: Number(orders._sum.discount ?? 0),
      services: Number(byType(OrderItemType.SERVICE)?._sum.total ?? 0),
      products: Number(byType(OrderItemType.PRODUCT)?._sum.total ?? 0),
      productUnits: byType(OrderItemType.PRODUCT)?._sum.quantity ?? 0,
      byMethod: payments.map((row) => ({
        method: row.method,
        count: row._count,
        amount: Number(row._sum.amount ?? 0),
      })),
    };
  }

  // Comanda do atendimento: a que já existe (ex.: criada pelo sinal) ou uma nova.
  async orderForAppointment(appointmentId: string, userId?: string) {
    const existing = await this.prisma.order.findUnique({
      where: { appointmentId },
      include: ORDER_INCLUDE,
    });
    if (existing) return mapOrder(existing);
    return this.createFromAppointment({ appointmentId }, userId);
  }

  private async createFromAppointment(dto: CreateOrderDto, userId?: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      include: { service: true, order: { select: { id: true } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.NO_SHOW
    ) {
      throw new BadRequestException('Agendamento cancelado não gera comanda.');
    }
    if (appointment.order) {
      throw new ConflictException('Este atendimento já tem comanda.');
    }

    try {
      const order = await this.prisma.order.create({
        data: {
          appointmentId: appointment.id,
          clientId: appointment.clientId,
          notes: dto.notes,
          openedById: userId,
          subtotal: appointment.price,
          total: appointment.price,
          items: {
            create: {
              type: OrderItemType.SERVICE,
              serviceId: appointment.serviceId,
              professionalId: appointment.professionalId,
              description: appointment.service.name,
              quantity: 1,
              unitPrice: appointment.price,
              total: appointment.price,
            },
          },
        },
        include: ORDER_INCLUDE,
      });
      return mapOrder(order);
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Este atendimento já tem comanda.');
      }
      throw error;
    }
  }

  // Aplica a mudança e recalcula os totais na mesma transação.
  private async mutateOpen(
    id: string,
    change: (tx: Tx, order: Awaited<ReturnType<OrdersService['lockOrder']>>) => Promise<void>,
  ) {
    const order = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, id);
      if (current.status !== OrderStatus.OPEN) {
        throw new ConflictException('Comanda fechada não pode ser alterada. Reabra antes.');
      }
      await change(tx, current);

      const fresh = await tx.order.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
      await tx.order.update({
        where: { id },
        data: computeTotals(fresh.items, fresh.discount),
      });
      return this.findOrThrow(tx, id);
    });
    return mapOrder(order);
  }

  // Trava a linha da comanda: duas pessoas mexendo ao mesmo tempo não
  // conseguem baixar ou devolver estoque em dobro.
  private async lockOrder(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "orders" WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Comanda não encontrada');
    return order;
  }

  private async returnStock(
    tx: Tx,
    order: { id: string; number: number; items: { productId: string | null; quantity: number }[] },
    userId: string | undefined,
    reason: string,
  ) {
    for (const [productId, quantity] of productQuantities(order.items)) {
      await this.stock.apply(tx, {
        productId,
        type: StockMovementType.RETURN,
        delta: quantity,
        orderId: order.id,
        userId,
        reason: `${reason} (#${order.number})`,
      });
    }
  }

  // O sinal do agendamento não trava a comanda: ele só abate do total.
  private async assertNoActivePayment(tx: Tx, orderId: string) {
    const active = await tx.orderPayment.findFirst({
      where: {
        orderId,
        isDeposit: false,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PAID] },
      },
    });
    if (active) {
      throw new ConflictException(
        active.status === PaymentStatus.PAID
          ? 'A comanda já tem pagamento confirmado.'
          : 'Cancele a cobrança pendente antes.',
      );
    }
  }

  private async assertClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente não encontrada');
  }

  private async findOrThrow(db: Tx | PrismaService, id: string) {
    const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Comanda não encontrada');
    return order;
  }
}

// Datas sem hora são dias de Aracaju (UTC-3, sem horário de verão).
const SALON_OFFSET = '-03:00';
const isDateOnly = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);

function startOfDay(date: string) {
  return new Date(isDateOnly(date) ? `${date}T00:00:00${SALON_OFFSET}` : date);
}

function endOfDay(date: string) {
  return new Date(isDateOnly(date) ? `${date}T23:59:59.999${SALON_OFFSET}` : date);
}
