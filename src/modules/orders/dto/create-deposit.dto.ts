import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { IsCpfCnpj } from '../../../shared/validators/cpf-cnpj';

export class CreateDepositDto {
  @ApiProperty({ description: 'CPF da cliente, exigido pelo Asaas' })
  @IsCpfCnpj()
  cpfCnpj: string;

  @ApiProperty({ enum: ['PIX', 'CREDIT_CARD'], example: 'PIX' })
  @IsIn(['PIX', 'CREDIT_CARD'], { message: 'Forma de pagamento inválida.' })
  method: 'PIX' | 'CREDIT_CARD';
}
