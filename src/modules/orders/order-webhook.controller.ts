import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { OrderWebhookService } from './order-webhook.service';

@ApiExcludeController()
@Controller('webhooks')
export class OrderWebhookController {
  constructor(private readonly webhookService: OrderWebhookService) {}

  @Public()
  @Post('asaas')
  @HttpCode(HttpStatus.OK)
  receive(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.webhookService.handle(token, payload);
  }
}
