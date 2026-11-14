import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientThrottlerGuard } from '../../shared/security/client-throttler.guard';
import { Public } from '../auth/decorators/public.decorator';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('Appointments')
@Controller('appointments')
export class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Public()
  @Post(':id/deposit')
  @UseGuards(ClientThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Gerar o sinal (Pix ou link de cartão) de um agendamento' })
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateDepositDto) {
    return this.deposits.start(id, dto);
  }

  @Public()
  @Get(':id/deposit/:paymentId')
  @UseGuards(ClientThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Situação do sinal de um agendamento' })
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.deposits.status(id, paymentId);
  }
}
