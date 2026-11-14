import { fromCents, toCents } from '../../../shared/money/money';

type PricedItem = { quantity: number; unitPrice: unknown };

export function itemTotal(quantity: number, unitPrice: unknown) {
  return fromCents(quantity * toCents(unitPrice as number));
}

// O desconto nunca passa do subtotal: a comanda não fica com total negativo.
export function computeTotals(items: PricedItem[], discount: unknown = 0) {
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.quantity * toCents(item.unitPrice as number),
    0,
  );
  const discountCents = Math.min(toCents(discount as number), subtotalCents);
  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(subtotalCents - discountCents),
  };
}

// Soma por produto: o mesmo produto pode aparecer em mais de uma linha.
export function productQuantities(
  items: { productId: string | null; quantity: number }[],
) {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return totals;
}
