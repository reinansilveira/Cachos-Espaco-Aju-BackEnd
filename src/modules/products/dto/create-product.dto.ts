import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType, ProductUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Creme de pentear Cachos Definidos 500ml' })
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório.' })
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Salon Line' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: ProductType, example: ProductType.SALE })
  @IsEnum(ProductType, { message: 'Tipo deve ser SALE ou INTERNAL_USE.' })
  type: ProductType;

  @ApiPropertyOptional({ enum: ProductUnit, default: ProductUnit.UNIT })
  @IsOptional()
  @IsEnum(ProductUnit, { message: 'Unidade inválida.' })
  unit?: ProductUnit;

  @ApiPropertyOptional({ example: 59.9, description: 'Obrigatório para venda' })
  @ValidateIf((dto: CreateProductDto) => dto.type === ProductType.SALE || dto.salePrice !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Preço de venda inválido.' })
  @Min(0, { message: 'Preço de venda não pode ser negativo.' })
  salePrice?: number;

  @ApiPropertyOptional({ example: 32.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Preço de custo inválido.' })
  @Min(0, { message: 'Preço de custo não pode ser negativo.' })
  costPrice?: number;

  @ApiPropertyOptional({ example: 10, description: 'Estoque inicial' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Estoque inicial deve ser inteiro.' })
  @Min(0)
  initialStock?: number;

  @ApiPropertyOptional({ example: 3, description: 'Abaixo disso, alerta de estoque baixo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Estoque mínimo deve ser inteiro.' })
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ example: '7898965420018' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;
}
