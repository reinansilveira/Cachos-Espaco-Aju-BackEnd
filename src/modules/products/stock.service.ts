import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type StockChange = {
  productId: string;
  type: StockMovementType;
  // Com sinal: entrada positiva, saída negativa.
  delta: number;
  reason?: string | null;
  unitCost?: number | null;
  orderId?: string | null;
  userId?: string | null;
};

// Único ponto que altera `stockQuantity`. Sempre roda dentro de uma transação
// e grava o movimento junto com o saldo resultante.
@Injectable()
export class StockService {
  async apply(tx: Tx, change: StockChange) {
    if (!Number.isInteger(change.delta) || change.delta === 0) {
      throw new BadRequestException('Quantidade do movimento inválida.');
    }

    // A condição no WHERE impede saldo negativo mesmo com baixas simultâneas.
    const updated = await tx.product.updateMany({
      where: {
        id: change.productId,
        ...(change.delta < 0 && { stockQuantity: { gte: -change.delta } }),
      },
      data: { stockQuantity: { increment: change.delta } },
    });

    const product = await tx.product.findUnique({
      where: { id: change.productId },
      select: { id: true, name: true, stockQuantity: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');

    if (updated.count === 0) {
      throw new ConflictException(
        `Estoque insuficiente de ${product.name}: há ${product.stockQuantity} e a saída pede ${-change.delta}.`,
      );
    }

    return tx.stockMovement.create({
      data: {
        productId: change.productId,
        type: change.type,
        quantity: change.delta,
        balanceAfter: product.stockQuantity,
        reason: change.reason ?? null,
        unitCost: change.unitCost ?? null,
        orderId: change.orderId ?? null,
        createdById: change.userId ?? null,
      },
    });
  }
}
