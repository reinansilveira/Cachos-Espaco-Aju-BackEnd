import { BadRequestException, ConflictException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { StockService } from '../../../src/modules/products/stock.service';
import { makePrismaMock } from '../../mocks/services/prisma.mock';

describe('StockService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  const service = new StockService();

  beforeEach(() => {
    prisma = makePrismaMock();
    prisma.stockMovement.create.mockImplementation(({ data }: any) => data);
  });

  it('dá entrada e grava o saldo resultante no movimento', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Creme', stockQuantity: 8 });

    const movement = await service.apply(prisma as any, {
      productId: 'p1',
      type: StockMovementType.IN,
      delta: 5,
      userId: 'u1',
    });

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stockQuantity: { increment: 5 } },
    });
    expect(movement).toMatchObject({ quantity: 5, balanceAfter: 8, createdById: 'u1' });
  });

  it('só baixa se houver saldo suficiente (condição no WHERE)', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 1 });
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Creme', stockQuantity: 0 });

    await service.apply(prisma as any, {
      productId: 'p1',
      type: StockMovementType.SALE,
      delta: -3,
    });

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', stockQuantity: { gte: 3 } },
      data: { stockQuantity: { increment: -3 } },
    });
  });

  it('recusa baixa maior que o estoque e não grava movimento', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 0 });
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Creme', stockQuantity: 2 });

    await expect(
      service.apply(prisma as any, {
        productId: 'p1',
        type: StockMovementType.SALE,
        delta: -3,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it.each([0, 1.5])('recusa quantidade inválida (%p)', async (delta) => {
    await expect(
      service.apply(prisma as any, { productId: 'p1', type: StockMovementType.IN, delta }),
    ).rejects.toThrow(BadRequestException);
  });
});
