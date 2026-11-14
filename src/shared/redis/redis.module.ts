import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: () => {
        // Prefixo para não misturar chaves com outros sistemas no mesmo Redis.
        const keyPrefix = 'cachos-aju:';
        // Redis gerenciado (Railway, Upstash) entrega uma URL com senha.
        if (process.env.REDIS_URL) {
          return new Redis(process.env.REDIS_URL, { keyPrefix });
        }
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          keyPrefix,
        });
      },
    },
  ],
  exports: ['REDIS'],
})
export class RedisModule {}
