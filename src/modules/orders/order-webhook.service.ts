import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  GatewayWebhookEvent,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../payment-gateway/payment-gateway.types';
import {
  ORDER_PAYMENT_REFERENCE,
  OrderPaymentsService,
} from './order-payments.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrderWebhookService {
  private readonly logger = new Logger(OrderWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: OrderPaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async handle(token: string | undefined, payload: unknown) {
    if (!this.gateway.isValidWebhookToken(token)) {
      throw new UnauthorizedException('Token de webhook inválido');
    }

    let event: GatewayWebhookEvent;
    try {
      event = this.gateway.parseWebhook(payload);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    try {
      // Registrar o evento e aplicar o efeito na mesma transação: se o
      // processamento falhar, o evento não fica marcado e o gateway reenvia.
      await this.prisma.$transaction(async (tx) => {
        await tx.gatewayWebhookEvent.create({
          data: {
            id: event.eventId,
            provider: this.gateway.provider,
            type: event.rawType,
            payload: payload as Prisma.InputJsonValue,
          },
        });
        await this.apply(tx, event);
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    return { received: true, duplicate: false };
  }

  private async apply(tx: Tx, event: GatewayWebhookEvent) {
    if (event.type === 'IGNORED' || !event.payment) return;

    const paymentId = await this.findPaymentId(tx, event);
    if (!paymentId) {
      // Cobrança criada fora do sistema (direto no painel do Asaas): só registra.
      this.logger.warn(
        `Webhook ${event.rawType} sem pagamento local (${event.payment.id})`,
      );
      return;
    }

    if (event.type === 'PAYMENT_DELETED') {
      await this.payments.markDeleted(tx, paymentId);
      return;
    }
    await this.payments.applyGatewayStatus(tx, paymentId, event.payment);
  }

  private async findPaymentId(tx: Tx, event: GatewayWebhookEvent) {
    const charge = event.payment!;
    const byGateway = await tx.orderPayment.findUnique({
      where: { gatewayPaymentId: charge.id },
      select: { id: true },
    });
    if (byGateway) return byGateway.id;

    const reference = charge.externalReference ?? '';
    if (!reference.startsWith(ORDER_PAYMENT_REFERENCE)) return null;
    const byReference = await tx.orderPayment.findUnique({
      where: { id: reference.slice(ORDER_PAYMENT_REFERENCE.length) },
      select: { id: true },
    });
    return byReference?.id ?? null;
  }
}
