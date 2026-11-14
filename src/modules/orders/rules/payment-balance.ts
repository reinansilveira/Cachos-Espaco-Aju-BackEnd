import { PaymentStatus } from '@prisma/client';
import { fromCents, toCents } from '../../../shared/money/money';

// Sinal do agendamento online: 20% do serviço, como no Trinks do salão.
export const DEPOSIT_RATE = 0.2;

export const depositAmount = (price: unknown) =>
  fromCents(Math.round(toCents(price as number) * DEPOSIT_RATE));

type PaymentLike = { status: PaymentStatus; amount: unknown };

export function paidAmount(payments: PaymentLike[]) {
  return fromCents(
    payments
      .filter((payment) => payment.status === PaymentStatus.PAID)
      .reduce((sum, payment) => sum + toCents(payment.amount as number), 0),
  );
}

// O que falta receber: total menos o que já foi pago (sinal incluído).
export const balanceDue = (total: unknown, payments: PaymentLike[]) =>
  fromCents(Math.max(0, toCents(total as number) - toCents(paidAmount(payments))));
