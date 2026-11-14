import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';
import { ProductsModule } from '../products/products.module';
import { ClientThrottlerGuard } from '../../shared/security/client-throttler.guard';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { OrderPaymentsService } from './order-payments.service';
import { OrderWebhookController } from './order-webhook.controller';
import { OrderWebhookService } from './order-webhook.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, AuthModule, PaymentGatewayModule, ProductsModule],
  controllers: [OrdersController, OrderWebhookController, DepositController],
  providers: [
    OrdersService,
    OrderPaymentsService,
    OrderWebhookService,
    DepositService,
    ClientThrottlerGuard,
  ],
})
export class OrdersModule {}
