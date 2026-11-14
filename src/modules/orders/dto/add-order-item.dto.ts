import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderItemType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class AddOrderItemDto {
  @ApiProperty({ enum: OrderItemType })
  @IsEnum(OrderItemType, { message: 'Tipo deve ser SERVICE ou PRODUCT.' })
  type: OrderItemType;

  @ApiPropertyOptional()
  @ValidateIf((dto: AddOrderItemDto) => dto.type === OrderItemType.PRODUCT)
  @IsUUID('4', { message: 'productId inválido.' })
  productId?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: AddOrderItemDto) => dto.type === OrderItemType.SERVICE)
  @IsUUID('4', { message: 'serviceId inválido.' })
  serviceId?: string;

  @ApiPropertyOptional({ description: 'Quem fez o serviço ou indicou o produto' })
  @IsOptional()
  @IsUUID('4', { message: 'professionalId inválido.' })
  professionalId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Quantidade deve ser inteira.' })
  @Min(1, { message: 'Quantidade mínima é 1.' })
  @Max(99)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Preço combinado, só para serviço' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;
}

export class UpdateOrderItemDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt({ message: 'Quantidade deve ser inteira.' })
  @Min(1, { message: 'Quantidade mínima é 1.' })
  @Max(99)
  quantity: number;
}
