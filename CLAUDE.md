# Espaço Cachos Aju — Backend

API do sistema do salão Espaço Cachos Aju (Aracaju/SE), em NestJS + Prisma (PostgreSQL). Nasceu do BarberHub, sem o clube de assinatura e com estoque e comanda. O front fica em `/home/reverbo/studing/cachos-espaco-aju-front` (Next.js).

## Comandos

- `npm run start:dev`: sobe a API com watch (porta `PORT`, padrão 3010)
- `npm run build`: compila com `nest build`
- `npm test`: testes unitários (Jest, arquivos `*.spec.ts`)
- `npm run seed`: conta da dona (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`), serviços do salão e produtos de exemplo. Pode rodar de novo.
- `npm run prisma:generate`, `npm run prisma:migrate` (dev), `npm run prisma:deploy` (produção)

## Banco

- Uma migration `init` com as tabelas e, no fim, as regras que o Prisma não expressa: CHECKs (estoque nunca negativo, `total = subtotal - discount`, `total` do item = quantidade × preço), exclusão de horário sobreposto e o índice parcial de pagamento por comanda (hoje, só um pendente; ver migration `order_deposit`). Mudou regra de banco? Escreva em SQL na migration nova.
- `docker-compose.yml` usa portas próprias (Postgres 5433, Redis 6380, RabbitMQ 5673) para rodar junto do BarberHub. Em dev local também dá para apontar para o Postgres/Redis/RabbitMQ do BarberHub: a fila é `cachos_aju_queue` e as chaves do Redis têm prefixo `cachos-aju:`.

## Integração com o front

- CORS libera `FRONTEND_URL` (padrão `http://localhost:3011`).
- O front chama a API via proxy `/api/backend/*` (Next.js) ou pelo `NEXT_PUBLIC_API_URL`.
- Login com Google: `/clients/google` e `/clients/google/exchange`. Sem `GOOGLE_CLIENT_ID` a API sobe, mas esse login falha.

## Variáveis de ambiente (`.env`, nunca versionar valores)

Veja `.env.example`. `PAYMENT_GATEWAY=fake` só vale fora de produção. `RABBITMQ_URL` e `RESEND_API_KEY` são opcionais: sem eles a API sobe e só os avisos não saem.

## Deploy

Render (`render.yaml`, API + Redis), Neon (Postgres) e Vercel (site). Passo a passo em `docs/DEPLOY.md`.

## Convenções

- Módulos em `src/modules/<nome>` (controller, service, dto, mappers, rules).
- Dinheiro é somado em centavos (`src/shared/money/money.ts`).
- Notificações têm worker separado: `npm run start:worker`.
- Erros fora de `HttpException` são logados pelo `AllExceptionsFilter` e respondem 500 genérico.

## Estoque e comanda

- `Product.type`: `SALE` entra na comanda; `INTERNAL_USE` só sai por baixa manual (`INTERNAL_USE`, `LOSS`, `ADJUSTMENT`).
- Todo movimento passa por `StockService.apply` (`src/modules/products/stock.service.ts`), dentro de transação: atualiza o saldo com condição no WHERE e grava o movimento com `balanceAfter`.
- Comanda: `OPEN` → `close` baixa o estoque → `AWAITING_PAYMENT` → `PAID`. `reopen`/`cancel` antes de pagar devolvem os produtos (`RETURN`). As mutações travam a linha da comanda (`SELECT … FOR UPDATE`).
- Contrato completo em `docs/FRONTEND_API.md`.

## Pagamentos

- Gateway atrás da interface `PaymentGateway` (`src/modules/payment-gateway`): cobrança avulsa (`createCharge`, `getCharge`, `cancelCharge`, `getPixQrCode`). Implementação: Asaas API v3. Para trocar, registre outra classe no token `PAYMENT_GATEWAY`.
- `ASAAS_BASE_URL` padrão é o sandbox (`https://api-sandbox.asaas.com/v3`). Em produção use `https://api.asaas.com/v3`.
- A cobrança leva `externalReference = order-payment:<id do OrderPayment>`.
- Webhook: `POST /webhooks/asaas`, público, valida `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN` e é idempotente pela tabela `gateway_webhook_events`. Cadastre URL e token no painel do Asaas (Integrações > Webhooks).
- Cartão pelo Asaas é pago no link (`invoiceUrl`): dados do cartão nunca passam pela API. Maquininha, dinheiro e Pix na chave do salão são registrados como pagamento manual (`gateway: false`).
- Teste local sem chave: `PAYMENT_GATEWAY=fake` e `node scripts/simulate-asaas-webhook.js <pago|vencido|recusado|estorno|excluida> [numero-da-comanda]`.
- `node scripts/check-asaas.js` confere se a chave conecta, sem imprimi-la.
- Sinal do site: `POST /appointments/:id/deposit` (público, `src/modules/orders/deposit.*`) cobra 20% (`DEPOSIT_RATE` em `rules/payment-balance.ts`) como `OrderPayment` com `isDeposit`. Pago, confirma o agendamento sem quitar a comanda; a comanda cobra `total - pago`. O índice parcial `order_payments_one_pending_per_order` permite só um pagamento pendente por comanda.
