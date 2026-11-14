import { Product, StockMovement, User } from '@prisma/client';
import { toNumber } from '../../../shared/money/money';

export const isLowStock = (product: Pick<Product, 'stockQuantity' | 'minStock'>) =>
  product.stockQuantity <= product.minStock;

export function mapProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    description: product.description,
    type: product.type,
    unit: product.unit,
    salePrice: toNumber(product.salePrice),
    costPrice: toNumber(product.costPrice),
    stockQuantity: product.stockQuantity,
    minStock: product.minStock,
    lowStock: isLowStock(product),
    barcode: product.barcode,
    image: product.image,
    active: product.active,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

type MovementWithRelations = StockMovement & {
  createdBy?: Pick<User, 'id' | 'name'> | null;
  product?: Pick<Product, 'id' | 'name' | 'type'> | null;
  order?: { id: string; number: number } | null;
};

export function mapStockMovement(movement: MovementWithRelations) {
  return {
    id: movement.id,
    productId: movement.productId,
    product: movement.product ?? undefined,
    type: movement.type,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    unitCost: toNumber(movement.unitCost),
    reason: movement.reason,
    order: movement.order ?? null,
    createdBy: movement.createdBy ?? null,
    createdAt: movement.createdAt,
  };
}
