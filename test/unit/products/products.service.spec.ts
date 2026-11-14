import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductType, ProductUnit, StockMovementType } from '@prisma/client';
import { ProductsService } from '../../../src/modules/products/products.service';
import { makePrismaMock } from '../../mocks/services/prisma.mock';

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Creme de pentear',
  brand: 'Marca',
  description: null,
  type: ProductType.SALE,
  unit: ProductUnit.UNIT,
  salePrice: 59.9,
  costPrice: 30,
  stockQuantity: 10,
  minStock: 2,
  barcode: null,
  image: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ProductsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let stock: { apply: jest.Mock };
  let service: ProductsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    stock = { apply: jest.fn().mockResolvedValue({ id: 'm1', quantity: 1, balanceAfter: 1 }) };
    service = new ProductsService(prisma as any, stock as any);
  });

  describe('create', () => {
    it('cria o produto com saldo zero e lança o estoque inicial como entrada', async () => {
      prisma.product.create.mockResolvedValue(product({ stockQuantity: 0 }));
      prisma.product.findUniqueOrThrow.mockResolvedValue(product({ stockQuantity: 6 }));

      const result = await service.create(
        { name: ' Creme ', type: ProductType.SALE, salePrice: 59.9, initialStock: 6, costPrice: 30 },
        'u1',
      );

      expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
        name: 'Creme',
        stockQuantity: 0,
      });
      expect(prisma.product.create.mock.calls[0][0].data).not.toHaveProperty('initialStock');
      expect(stock.apply).toHaveBeenCalledWith(prisma, {
        productId: 'p1',
        type: StockMovementType.IN,
        delta: 6,
        unitCost: 30,
        reason: 'Estoque inicial',
        userId: 'u1',
      });
      expect(result.stockQuantity).toBe(6);
    });

    it('não lança movimento quando não há estoque inicial', async () => {
      prisma.product.create.mockResolvedValue(product({ type: ProductType.INTERNAL_USE }));
      prisma.product.findUniqueOrThrow.mockResolvedValue(product());

      await service.create({ name: 'Luva', type: ProductType.INTERNAL_USE });

      expect(stock.apply).not.toHaveBeenCalled();
    });

    it('exige preço de venda para produto de venda', async () => {
      await expect(
        service.create({ name: 'Óleo', type: ProductType.SALE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('filtra estoque baixo e marca lowStock', async () => {
      prisma.product.findMany.mockResolvedValue([
        product({ id: 'a', stockQuantity: 1, minStock: 2 }),
        product({ id: 'b', stockQuantity: 9, minStock: 2 }),
      ]);

      const result = await service.findAll({ lowStock: true });

      expect(result.map((item) => item.id)).toEqual(['a']);
      expect(result[0].lowStock).toBe(true);
      expect(prisma.product.findMany.mock.calls[0][0].where.active).toBe(true);
    });
  });

  describe('registerMovement', () => {
    beforeEach(() => prisma.product.findUnique.mockResolvedValue(product()));

    it('baixa de uso interno sai com quantidade negativa', async () => {
      await service.registerMovement('p1', { type: 'INTERNAL_USE', quantity: 2 }, 'u1');

      expect(stock.apply).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: StockMovementType.INTERNAL_USE, delta: -2 }),
      );
    });

    it('ajuste lança a diferença entre a contagem e o saldo', async () => {
      await service.registerMovement('p1', { type: 'ADJUSTMENT', quantity: 7 });

      expect(stock.apply).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: StockMovementType.ADJUSTMENT, delta: -3 }),
      );
    });

    it('recusa ajuste quando a contagem bate com o saldo', async () => {
      await expect(
        service.registerMovement('p1', { type: 'ADJUSTMENT', quantity: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('entrada com custo atualiza o custo de referência', async () => {
      await service.registerMovement('p1', { type: 'IN', quantity: 4, unitCost: 28 });

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { costPrice: 28 },
      });
    });

    it('recusa movimento de produto desativado', async () => {
      prisma.product.findUnique.mockResolvedValue(product({ active: false }));

      await expect(
        service.registerMovement('p1', { type: 'IN', quantity: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('produto inexistente', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.registerMovement('x', { type: 'IN', quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
