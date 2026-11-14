import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payment-gateway/payment-gateway.types';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { mapOrderPayment } from './mappers/order.mapper';
import {
  ORDER_PAYMENT_REFERENCE,
  OrderPaymentsService,
  todayInSalon,
} from './order-payments.service';
import { OrdersService } from './orders.service';
import { depositAmount } from './rules/payment-balance';

const OPEN_STATUSES: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

// Sinal pago pela cliente logo depois de agendar no site. Vira um pagamento
// da comanda do atendimento e, pago, confirma o agendamento.
@Injectable()
export class DepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: OrderPaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async start(appointmentId: string, dto: CreateDepositDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { service: true, client: { include: { user: true } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (!OPEN_STATUSES.includes(appointment.status) || appointment.scheduledAt < new Date()) {
      throw new BadRequestException('Este agendamento não aceita mais sinal.');
    }

    const order = await this.orders.orderForAppointment(appointmentId);
    if (order.payments.some((payment) => payment.isDeposit && payment.status === PaymentStatus.PAID)) {
      throw new ConflictException('O sinal deste horário já foi pago.');
    }
    // Trocar de Pix para cartão cancela a cobrança anterior.
    await this.payments.cancelPendingForOrder(order.id);

    const amount = depositAmount(appointment.price);
    const customerId = await this.payments.customerFor(appointment.client, dto.cpfCnpj);
    const paymentId = randomUUID();
    const when = appointment.scheduledAt.toLocaleString('pt-BR', {
      timeZone: 'America/Maceio',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const charge = await this.gateway.createCharge({
      customerId,
      billingType: dto.method,
      value: amount,
      dueDate: todayInSalon(),
      description: `Espaço Cachos Aju - sinal de ${appointment.service.name} (${when})`,
      externalReference: `${ORDER_PAYMENT_REFERENCE}${paymentId}`,
    });
    const pix = dto.method === 'PIX' ? await this.payments.safePixQrCode(charge.id) : null;

    try {
      const payment = await this.prisma.orderPayment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          method: dto.method === 'PIX' ? PaymentMethod.PIX : PaymentMethod.CREDIT_CARD,
          gateway: true,
          isDeposit: true,
          status: PaymentStatus.PENDING,
          amount,
          gatewayPaymentId: charge.id,
          invoiceUrl: charge.invoiceUrl,
          pixPayload: pix?.payload ?? null,
          dueDate: new Date(`${charge.dueDate}T23:59:59-03:00`),
          notes: 'Sinal do agendamento online',
        },
      });
      return { ...mapOrderPayment(payment), pixQrCodeImage: pix?.encodedImage ?? null };
    } catch (error) {
      await this.gateway.cancelCharge(charge.id).catch(() => undefined);
      throw error;
    }
  }

  // Consultado pelo site enquanto a cliente paga; também confere no Asaas.
  async status(appointmentId: string, paymentId: string) {
    const payment = await this.prisma.orderPayment.findFirst({
      where: { id: paymentId, isDeposit: true, order: { appointmentId } },
    });
    if (!payment) throw new NotFoundException('Sinal não encontrado');

    let current = payment;
    if (payment.status === PaymentStatus.PENDING && payment.gatewayPaymentId) {
      const charge = await this.gateway.getCharge(payment.gatewayPaymentId).catch(() => null);
      if (charge) {
        current = await this.prisma.$transaction((tx) =>
          this.payments.applyGatewayStatus(tx, payment.id, charge),
        );
      }
    }
    return { id: current.id, status: current.status, amount: Number(current.amount) };
  }
}
