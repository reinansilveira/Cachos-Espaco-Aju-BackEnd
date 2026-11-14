import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Prisma } from '@prisma/client';
import { EMPTY, Observable, catchError, tap } from 'rxjs';

// Erros que se repetiriam em qualquer nova entrega do mesmo evento.
const PERMANENT_PRISMA_CODES = new Set(['P2003', 'P2025']);

export function isPermanentConsumerError(error: unknown): boolean {
  if (error instanceof HttpException) return true;
  if (error instanceof Prisma.PrismaClientValidationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return PERMANENT_PRISMA_CODES.has(error.code);
  }
  return false;
}

/**
 * Confirma no broker cada evento RMQ consumido com `noAck: false`.
 *
 * - sucesso: ack;
 * - erro permanente (ex.: agendamento apagado): nack sem requeue;
 * - erro transitório: uma nova entrega; se já for reentrega, nack sem requeue.
 *
 * O erro não é repassado ao Nest: ele já foi tratado aqui, e repassar só
 * duplicaria o log.
 */
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RmqAckInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();

    const rmq = context.switchToRpc().getContext<RmqContext>();
    if (!(rmq instanceof RmqContext)) return next.handle();

    const channel = rmq.getChannelRef();
    const message = rmq.getMessage();
    const pattern = rmq.getPattern();

    return next.handle().pipe(
      tap({ complete: () => this.settle(() => channel.ack(message), pattern) }),
      catchError((error) => {
        const permanent = isPermanentConsumerError(error);
        const requeue = !permanent && !message.fields?.redelivered;
        const reason = error?.message || error;

        if (permanent) {
          this.logger.warn(`Evento ${pattern} descartado: ${reason}`);
        } else if (requeue) {
          this.logger.warn(`Evento ${pattern} falhou, nova tentativa: ${reason}`);
        } else {
          this.logger.error(`Evento ${pattern} descartado após nova tentativa: ${reason}`);
        }

        this.settle(() => channel.nack(message, false, requeue), pattern);
        return EMPTY;
      }),
    );
  }

  private settle(confirm: () => void, pattern: string) {
    try {
      confirm();
    } catch (error: any) {
      // Canal fechado: o broker reentrega sozinho quando reconectar.
      this.logger.error(`Falha ao confirmar ${pattern}: ${error?.message || error}`);
    }
  }
}
