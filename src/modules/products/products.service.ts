import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType, StockMovementType } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  isLowStock,
  mapProduct,
  mapStockMovement,
} from './mappers/product.mapper';
import { StockService } from './stock.service';

const MOVEMENT_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  order: { select: { id: true, number: true } },
} satisfies Prisma.StockMovementInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async findAll(query: ListProductsQuery) {
    const search = query.search?.trim();
    const products = await this.prisma.product.findMany({
      where: {
        type: query.type,
        active: query.active ?? true,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { brand: { contains: search, mode: 'insensitive' } },
            { barcode: search },
          ],
        }),
      },
      orderBy: { name: 'asc' },
    });

    // Prisma não compara duas colunas no `where`; a lista do salão é pequena.
    const filtered = query.lowStock ? products.filter(isLowStock) : products;
    return filtered.map(mapProduct);
  }

  async findById(id: string) {
    const product = await this.findOrThrow(id);
    const movements = await this.prisma.stockMovement.findMany({
      where: { productId: id },
      include: MOVEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return { ...mapProduct(product), movements: movements.map(mapStockMovement) };
  }

  async create(dto: CreateProductDto, userId?: string) {
    this.assertPriceForType(dto.type, dto.salePrice);
    const { initialStock, ...data } = dto;

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: { ...data, name: data.name.trim(), stockQuantity: 0 },
        });
        if (initialStock) {
          await this.stock.apply(tx, {
            productId: created.id,
            type: StockMovementType.IN,
            delta: initialStock,
            unitCost: dto.costPrice,
            reason: 'Estoque inicial',
            userId,
          });
        }
        return tx.product.findUniqueOrThrow({ where: { id: created.id } });
      });
      return mapProduct(product);
    } catch (error) {
      throw this.translateUniqueError(error);
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const current = await this.findOrThrow(id);
    this.assertPriceForType(
      dto.type ?? current.type,
      dto.salePrice ?? (current.salePrice === null ? undefined : Number(current.salePrice)),
    );

    try {
      const product = await this.prisma.product.update({
        where: { id },
        data: { ...dto, name: dto.name?.trim() },
      });
      return mapProduct(product);
    } catch (error) {
      throw this.translateUniqueError(error);
    }
  }

  // Desativa em vez de apagar: o histórico de comandas e movimentos continua.
  async deactivate(id: string) {
    await this.findOrThrow(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { active: false },
    });
    return mapProduct(product);
  }

  async listMovements(productId?: string, take = 50) {
    const movements = await this.prisma.stockMovement.findMany({
      where: { productId },
      include: {
        ...MOVEMENT_INCLUDE,
        product: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
    });
    return movements.map(mapStockMovement);
  }

  async registerMovement(
    productId: string,
    dto: CreateStockMovementDto,
    userId?: string,
  ) {
    const product = await this.findOrThrow(productId);
    if (!product.active) {
      throw new BadRequestException('Produto desativado não movimenta estoque.');
    }

    const delta = this.deltaFor(dto, product.stockQuantity);
    if (delta === 0) {
      throw new BadRequestException(
        dto.type === 'ADJUSTMENT'
          ? 'A contagem é igual ao saldo atual; nada a ajustar.'
          : 'Informe uma quantidade maior que zero.',
      );
    }

    const movement = await this.prisma.$transaction((tx) =>
      this.stock.apply(tx, {
        productId,
        type: StockMovementType[dto.type],
        delta,
        unitCost: dto.type === 'IN' ? dto.unitCost : undefined,
        reason: dto.reason,
        userId,
      }),
    );

    // Entrada com custo informado atualiza o custo de referência do produto.
    if (dto.type === 'IN' && dto.unitCost !== undefined) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { costPrice: dto.unitCost },
      });
    }

    return mapStockMovement(movement);
  }

  private deltaFor(dto: CreateStockMovementDto, currentStock: number) {
    switch (dto.type) {
      case 'IN':
        return dto.quantity;
      case 'INTERNAL_USE':
      case 'LOSS':
        return -dto.quantity;
      case 'ADJUSTMENT':
        return dto.quantity - currentStock;
    }
  }

  private assertPriceForType(type: ProductType, salePrice?: number | null) {
    if (type === ProductType.SALE && (salePrice === undefined || salePrice === null)) {
      throw new BadRequestException('Produto de venda precisa de preço de venda.');
    }
  }

  private async findOrThrow(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }

  private translateUniqueError(error: unknown) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe um produto com esse código de barras.');
    }
    return error;
  }
}
