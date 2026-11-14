import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsaasGateway } from './asaas/asaas.gateway';
import { FakeGateway } from './fake/fake.gateway';
import { PAYMENT_GATEWAY } from './payment-gateway.types';

// Para trocar de gateway, registre outra implementação de `PaymentGateway`
// neste token. `PAYMENT_GATEWAY=fake` só vale fora de produção.
@Module({
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const useFake =
          config.get('PAYMENT_GATEWAY') === 'fake' &&
          config.get('NODE_ENV') !== 'production';
        return useFake ? new FakeGateway(config) : new AsaasGateway(config);
      },
    },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
