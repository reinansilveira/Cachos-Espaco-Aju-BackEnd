import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateOrderDto {
  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Desconto inválido.' })
  @Min(0, { message: 'Desconto não pode ser negativo.' })
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'clientId inválido.' })
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'Cliente desistiu dos produtos' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
