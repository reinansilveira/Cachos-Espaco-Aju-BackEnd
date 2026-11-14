# Deploy

A API sobe com o `Dockerfile` da raiz, que aplica as migrations (`prisma migrate deploy`) antes de iniciar. O front é um Next.js comum (Vercel ou qualquer host Node).

## API

Precisa de Postgres, Redis e RabbitMQ. No Railway: um serviço a partir deste repositório (detecta o `Dockerfile`), mais Postgres, Redis e RabbitMQ (template).

Variáveis (nomes em `.env.example`, valores nunca no repositório):

- `DATABASE_URL` e `DIRECT_URL`: do Postgres.
- `REDIS_URL` (ou `REDIS_HOST`/`REDIS_PORT`) e `RABBITMQ_URL`.
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (aleatórios e longos), `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`.
- `FRONTEND_URL`: domínio do site, para o CORS.
- `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`. Para a fase de teste, chave e URL do sandbox (`https://api-sandbox.asaas.com/v3`). `PAYMENT_GATEWAY=fake` é ignorado com `NODE_ENV=production`.
- `RESEND_API_KEY` e `EVOLUTION_*` só se for mandar e-mail e WhatsApp.
- `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`: conta da dona criada pelo seed.

Depois do primeiro deploy, rode o seed uma vez no serviço (`node scripts/seed.js`): cria a conta da dona, serviços, as duas profissionais e horários de 28 dias. Rodar de novo completa os horários sem duplicar.

No painel do Asaas (Integrações > Webhooks), cadastre `https://<api>/webhooks/asaas` com o mesmo `ASAAS_WEBHOOK_TOKEN`.

## Front

- `NEXT_PUBLIC_API_URL` e `BACKEND_URL`: URL pública da API.
- `NEXT_PUBLIC_SITE_URL`: domínio do site.
- `NEXT_PUBLIC_BUSINESS_*`: contatos mostrados no site.
