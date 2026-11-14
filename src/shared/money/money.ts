import { Prisma } from '@prisma/client';

type Amount = Prisma.Decimal | number | string;

// Valores de dinheiro são somados em centavos para não acumular erro de float.
export const toCents = (value: Amount) => Math.round(Number(value) * 100);

export const fromCents = (cents: number) => cents / 100;

export const toNumber = (value: Amount | null | undefined) =>
  value === null || value === undefined ? null : Number(value);
