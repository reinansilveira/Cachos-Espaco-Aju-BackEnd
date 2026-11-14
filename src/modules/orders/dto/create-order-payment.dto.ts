import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsCpfCnpj } from '../../../shared/validators/cpf-cnpj';

export class CreateOrderPaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod, { message: 'Forma de pagamento inválida.' })
  method: PaymentMethod;

  @ApiPropertyOptional({
    default: false,
    description:
      'true gera cobrança no Asaas (Pix com QR ou link de cartão). false registra pagamento já recebido (maquininha, dinheiro, Pix na chave).',
  })
  @IsOptional()
  @IsBoolean()
  gateway?: boolean;

  @ApiPropertyOptional({ description: 'CPF da cliente, exigido pelo Asaas na primeira cobrança' })
  @IsOptional()
  @IsCpfCnpj()
  cpfCnpj?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
