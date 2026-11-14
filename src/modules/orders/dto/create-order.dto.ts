import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Abre a comanda já com o serviço do agendamento' })
  @IsOptional()
  @IsUUID('4', { message: 'appointmentId inválido.' })
  appointmentId?: string;

  @ApiPropertyOptional({ description: 'Cliente da comanda avulsa' })
  @IsOptional()
  @IsUUID('4', { message: 'clientId inválido.' })
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
