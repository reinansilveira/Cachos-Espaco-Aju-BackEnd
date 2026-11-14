# Deploy

Produção grátis: API e Redis no Render (`render.yaml`), Postgres no Neon e site na Vercel.

## API (Render)

- O `Dockerfile` da raiz aplica as migrations, roda o seed (se `SEED_ADMIN_EMAIL` existir) e sobe a API. O seed só cria o que falta e completa os horários dos próximos 28 dias, então cada reinício mantém a agenda aberta.
- Crie pelo Blueprint (New > Blueprint, este repositório). Ele pede os valores marcados com `sync: false`:
  - `DATABASE_URL`: string de conexão do Neon (projeto `cachos-aju`).
  - `ASAAS_API_KEY`: chave do sandbox na fase de teste.
  - `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`: login da dona no painel.
- `SEED_DEMO=true` (no `render.yaml`) cria uma vez clientes, agenda, comandas e estoque de demonstração (`scripts/seed-demo.js`). Clientes de demonstração têm e-mail `@exemplo.com`. A configuração `demo.seeded` impede que voltem depois de apagados.
- `JWT_SECRET`, `JWT_REFRESH_SECRET` e `ASAAS_WEBHOOK_TOKEN` são gerados pelo Render.
- RabbitMQ e Resend são opcionais: sem `RABBITMQ_URL` ou `RESEND_API_KEY` a API sobe e só os avisos por e-mail/WhatsApp não saem.
- O plano grátis dorme depois de 15 min sem acesso; a primeira requisição depois disso leva uns 50 s.
- Webhook do Asaas (Integrações > Webhooks): `https://<api>/webhooks/asaas`, com o valor de `ASAAS_WEBHOOK_TOKEN` que está no Render.
- `FRONTEND_URL` precisa ser o domínio do site (CORS).

## Site (Vercel)

- `NEXT_PUBLIC_API_URL` e `BACKEND_URL`: URL pública da API no Render.
- `NEXT_PUBLIC_SITE_URL`: domínio do site.
