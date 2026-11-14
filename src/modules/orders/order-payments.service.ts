import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  OrderPayment,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { normalizeCpfCnpj } from '../../shared/validators/cpf-cnpj';
import {
  GatewayBillingType,
  GatewayPayment,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../payment-gateway/payment-gateway.types';
import { CreateOrderPaymentDto } from './dto/create-order-payment.dto';
import { mapOrderPayment } from './mappers/order.mapper';
import { balanceDue } from './rules/payment-balance';

type Tx = Prisma.TransactionClient;

const GATEWAY_METHODS: Record<string, GatewayBillingType> = {
  [PaymentMethod.PIX]: 'PIX',
  [PaymentMethod.CREDIT_CARD]: 'CREDIT_CARD',
};

export const ORDER_PAYMENT_REFERENCE = 'order-payment:';

@Injectable()
export class OrderPaymentsService {
  private readonly logger = new Logger(OrderPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async create(orderId: string, dto: CreateOrderPaymentDto, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { client: { include: { user: true } }, payments: true },
    });
    if (!order) throw new NotFoundException('Comanda não encontrada');
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      throw new ConflictException('Feche a comanda antes de registrar o pagamento.');
    }
    // O sinal pago no agendamento já abate do total.
    const due = balanceDue(order.total, order.payments);
    if (due <= 0) throw new ConflictException('A comanda já está quitada.');

    // Trocar de forma (Pix → cartão) cancela a cobrança anterior.
    await this.cancelPendingForOrder(orderId);

    if (!dto.gateway) {
      return this.registerManual(order.id, due, dto, userId);
    }

    const billingType = GATEWAY_METHODS[dto.method];
    if (!billingType) {
      throw new BadRequestException('Pelo Asaas só dá para cobrar Pix ou cartão de crédito.');
    }
    if (!order.client) {
      throw new BadRequestException('Escolha a cliente da comanda para gerar a cobrança.');
    }

    const customerId = await this.customerFor(order.client, dto.cpfCnpj);
    const paymentId = randomUUID();
    const charge = await this.gateway.createCharge({
      customerId,
      billingType,
      value: due,
      dueDate: todayInSalon(),
      description: `Espaço Cachos Aju - comanda #${order.number}`,
      externalReference: `${ORDER_PAYMENT_REFERENCE}${paymentId}`,
    });

    const pix = billingType === 'PIX' ? await this.safePixQrCode(charge.id) : null;

    try {
      const payment = await this.prisma.orderPayment.create({
        data: {
          id: paymentId,
          orderId,
          method: dto.method,
          gateway: true,
          status: PaymentStatus.PENDING,
          amount: due,
          gatewayPaymentId: charge.id,
          invoiceUrl: charge.invoiceUrl,
          pixPayload: pix?.payload ?? null,
          dueDate: new Date(`${charge.dueDate}T23:59:59-03:00`),
          notes: dto.notes,
          createdById: userId,
        },
      });
      return { ...mapOrderPayment(payment), pixQrCodeImage: pix?.encodedImage ?? null };
    } catch (error) {
      // Sem registro local a cobrança ficaria órfã no Asaas.
      await this.gateway.cancelCharge(charge.id).catch(() => undefined);
      throw error;
    }
  }

  async getPix(paymentId: string) {
    const payment = await this.findOrThrow(paymentId);
    if (!payment.gateway || payment.method !== PaymentMethod.PIX || !payment.gatewayPaymentId) {
      throw new BadRequestException('Este pagamento não é um Pix do Asaas.');
    }
    const pix = await this.gateway.getPixQrCode(payment.gatewayPaymentId);
    return { ...mapOrderPayment(payment), pixPayload: pix.payload, pixQrCodeImage: pix.encodedImage };
  }

  // Consulta o Asaas na hora: útil se o webhook atrasar ou não estiver configurado.
  async refresh(paymentId: string) {
    const payment = await this.findOrThrow(paymentId);
    if (!payment.gateway || !payment.gatewayPaymentId) return mapOrderPayment(payment);
    const charge = await this.gateway.getCharge(payment.gatewayPaymentId);
    const updated = await this.prisma.$transaction((tx) =>
      this.applyGatewayStatus(tx, payment.id, charge),
    );
    return mapOrderPayment(updated);
  }

  async cancel(paymentId: string) {
    const payment = await this.findOrThrow(paymentId);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException('Só uma cobrança pendente pode ser cancelada.');
    }
    if (payment.gatewayPaymentId) await this.gateway.cancelCharge(payment.gatewayPaymentId);
    const updated = await this.prisma.orderPayment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.CANCELLED },
    });
    return mapOrderPayment(updated);
  }

  async cancelPendingForOrder(orderId: string) {
    const pending = await this.prisma.orderPayment.findMany({
      where: { orderId, status: PaymentStatus.PENDING },
    });
    for (const payment of pending) await this.cancel(payment.id);
  }

  // Ponto único que traduz o status do gateway para pagamento e comanda.
  async applyGatewayStatus(tx: Tx, paymentId: string, charge: GatewayPayment) {
    const payment = await tx.orderPayment.findUniqueOrThrow({ where: { id: paymentId } });

    switch (charge.status) {
      case 'PAID': {
        if (payment.status === PaymentStatus.PAID) return payment;
        const paidAt = paidAtFrom(charge.paidAt);
        const updated = await tx.orderPayment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.PAID, paidAt },
        });
        if (payment.isDeposit) {
          await this.confirmAppointment(tx, payment.orderId);
          return updated;
        }
        await tx.order.updateMany({
          where: { id: payment.orderId, status: OrderStatus.AWAITING_PAYMENT },
          data: { status: OrderStatus.PAID, paidAt },
        });
        return updated;
      }
      case 'REFUNDED': {
        if (payment.status === PaymentStatus.REFUNDED) return payment;
        const updated = await tx.orderPayment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
        });
        if (payment.isDeposit) return updated;
        // Estornado: a conta volta a ficar em aberto para cobrar de outra forma.
        await tx.order.updateMany({
          where: { id: payment.orderId, status: OrderStatus.PAID },
          data: { status: OrderStatus.AWAITING_PAYMENT, paidAt: null },
        });
        return updated;
      }
      case 'OVERDUE':
      case 'FAILED':
        if (payment.status !== PaymentStatus.PENDING) return payment;
        return tx.orderPayment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.FAILED },
        });
      default:
        return payment;
    }
  }

  async markDeleted(tx: Tx, paymentId: string) {
    await tx.orderPayment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED },
    });
  }

  private async registerManual(
    orderId: string,
    amount: number,
    dto: CreateOrderPaymentDto,
    userId?: string,
  ) {
    const now = new Date();
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.orderPayment.create({
        data: {
          orderId,
          method: dto.method,
          gateway: false,
          status: PaymentStatus.PAID,
          amount,
          paidAt: now,
          notes: dto.notes,
          createdById: userId,
        },
      });
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.AWAITING_PAYMENT },
        data: { status: OrderStatus.PAID, paidAt: now },
      });
      if (updated.count === 0) {
        throw new ConflictException('A comanda mudou enquanto o pagamento era registrado.');
      }
      return created;
    });
    return { ...mapOrderPayment(payment), pixQrCodeImage: null };
  }

  // Sinal pago confirma o agendamento que estava pendente.
  private async confirmAppointment(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { appointmentId: true },
    });
    if (!order?.appointmentId) return;
    await tx.appointment.updateMany({
      where: { id: order.appointmentId, status: AppointmentStatus.PENDING },
      data: { status: AppointmentStatus.CONFIRMED },
    });
  }

  async customerFor(
    client: {
      id: string;
      cpfCnpj: string | null;
      gatewayCustomerId: string | null;
      user: { name: string; email: string | null; phone: string | null };
    },
    cpfCnpj?: string,
  ) {
    const document = cpfCnpj ? normalizeCpfCnpj(cpfCnpj) : client.cpfCnpj;
    if (client.gatewayCustomerId && (!cpfCnpj || document === client.cpfCnpj)) {
      return client.gatewayCustomerId;
    }
    if (!document) {
      throw new BadRequestException('Informe o CPF da cliente para gerar a cobrança.');
    }

    const customer = await this.gateway.createCustomer({
      name: client.user.name,
      cpfCnpj: document,
      email: client.user.email,
      phone: client.user.phone,
      externalReference: client.id,
    });
    await this.prisma.client.update({
      where: { id: client.id },
      data: { cpfCnpj: document, gatewayCustomerId: customer.id },
    });
    return customer.id;
  }

  // O QR pode demorar alguns segundos para existir no Asaas; o front busca de novo.
  async safePixQrCode(chargeId: string) {
    try {
      return await this.gateway.getPixQrCode(chargeId);
    } catch (error) {
      this.logger.warn(`QR Pix de ${chargeId} indisponível: ${(error as Error).message}`);
      return null;
    }
  }

  private async findOrThrow(id: string): Promise<OrderPayment> {
    const payment = await this.prisma.orderPayment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    return payment;
  }
}

export function todayInSalon() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Maceio' }).format(new Date());
}

// O Asaas manda só a data do pagamento (AAAA-MM-DD). Lida como UTC, viraria a
// noite anterior em Aracaju; pago hoje vale a hora em que soubemos.
export function paidAtFrom(gatewayDate: string | null) {
  if (!gatewayDate) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gatewayDate)) return new Date(gatewayDate);
  if (gatewayDate === todayInSalon()) return new Date();
  return new Date(`${gatewayDate}T12:00:00-03:00`);
}
