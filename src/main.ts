import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PrismaService } from './shared/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // A fila só alimenta os avisos por e-mail/WhatsApp; sem ela a API sobe igual.
  if (process.env.RABBITMQ_URL) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL],
        queue: 'cachos_aju_queue',
        queueOptions: { durable: true },
        noAck: false,
      },
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3011',
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  const reflector = app.get(Reflector);
  const jwtService = app.get(JwtService);
  const prisma = app.get(PrismaService);

  app.useGlobalGuards(new JwtAuthGuard(reflector, jwtService, prisma));

  const config = new DocumentBuilder()
    .setTitle('Espaço Cachos Aju API')
    .setDescription('API para gerenciar clientes e serviços do Espaço Cachos Aju')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3010);
}
bootstrap();
