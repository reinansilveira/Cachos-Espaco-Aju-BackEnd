# Espaço Cachos Aju — API

Sistema do salão Espaço Cachos Aju (Aracaju/SE): agendamento, clientes, profissionais, estoque de produtos e comanda com pagamento por Pix e cartão (Asaas).

## Rodando local

```bash
cp .env.example .env   # preencha os valores
docker compose up -d postgres redis rabbitmq
npm install
npm run prisma:deploy
npm run seed
npm run start:dev
```

API em `http://localhost:3010`, Swagger em `http://localhost:3010/api`.

## Testes

```bash
npm test
```

Mais detalhes em `CLAUDE.md` e no contrato da API em `docs/FRONTEND_API.md`.
