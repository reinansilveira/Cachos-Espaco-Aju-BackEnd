import {
  computeTotals,
  itemTotal,
  productQuantities,
} from '../../../src/modules/orders/rules/order-totals';

describe('order totals', () => {
  it('soma serviço e produtos em centavos, sem erro de float', () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPrice: 120 },
        { quantity: 3, unitPrice: 19.9 },
      ],
      0.1,
    );

    expect(totals).toEqual({ subtotal: 179.7, discount: 0.1, total: 179.6 });
  });

  it('limita o desconto ao subtotal', () => {
    expect(computeTotals([{ quantity: 1, unitPrice: 50 }], 80)).toEqual({
      subtotal: 50,
      discount: 50,
      total: 0,
    });
  });

  it('calcula o total da linha', () => {
    expect(itemTotal(3, '19.90')).toBe(59.7);
  });

  it('agrupa quantidades por produto e ignora serviços', () => {
    const totals = productQuantities([
      { productId: 'a', quantity: 2 },
      { productId: null, quantity: 1 },
      { productId: 'a', quantity: 1 },
      { productId: 'b', quantity: 4 },
    ]);

    expect([...totals]).toEqual([
      ['a', 3],
      ['b', 4],
    ]);
  });
});
