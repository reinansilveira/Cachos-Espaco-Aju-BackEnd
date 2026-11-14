import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// Movimentos lançados à mão. Venda e devolução só nascem da comanda.
export const MANUAL_MOVEMENT_TYPES = [
  'IN',
  'INTERNAL_USE',
  'LOSS',
  'ADJUSTMENT',
] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class CreateStockMovementDto {
  @ApiProperty({
    enum: MANUAL_MOVEMENT_TYPES,
    description:
      'IN entrada, INTERNAL_USE uso no salão, LOSS perda/vencido, ADJUSTMENT contagem',
  })
  @IsIn(MANUAL_MOVEMENT_TYPES, { message: 'Tipo de movimento inválido.' })
  type: ManualMovementType;

  @ApiProperty({
    example: 5,
    description:
      'Quantidade movimentada. No ajuste, é a quantidade contada na prateleira.',
  })
  @Type(() => Number)
  @IsInt({ message: 'Quantidade deve ser inteira.' })
  @Min(0, { message: 'Quantidade não pode ser negativa.' })
  quantity: number;

  @ApiPropertyOptional({ example: 32.5, description: 'Custo unitário na entrada' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ example: 'Compra no distribuidor' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
