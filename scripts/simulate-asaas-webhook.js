// Simula eventos do webhook do Asaas contra a API local (só para dev).
//
//   node scripts/simulate-asaas-webhook.js <evento> [numero-da-comanda]
//
// Eventos: pago | vencido | recusado | estorno | excluida
// Sem número, usa a cobrança do Asaas criada mais recentemente.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const EVENTS = {
  pago: 'PAYMENT_RECEIVED',
  vencido: 'PAYMENT_OVERDUE',
  recusado: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  estorno: 'PAYMENT_REFUNDED',
  excluida: 'PAYMENT_DELETED',
};
const STATUS = {
  PAYMENT_RECEIVED: 'RECEIVED',
  PAYMENT_OVERDUE: 'OVERDUE',
  PAYMENT_REFUNDED: 'REFUNDED',
};

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
);
const API = `http://localhost:${env.PORT || 3010}`;
const ymd = (date) => date.toISOString().slice(0, 10);

async function main() {
  const [name, number] = process.argv.slice(2);
  const event = EVENTS[name];
  if (!event) {
    console.error(`Uso: node scripts/simulate-asaas-webhook.js <${Object.keys(EVENTS).join('|')}> [numero-da-comanda]`);
    process.exit(1);
  }
  if (!env.ASAAS_WEBHOOK_TOKEN) {
    console.error('Defina ASAAS_WEBHOOK_TOKEN no .env.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const payment = await prisma.orderPayment.findFirst({
      where: {
        gateway: true,
        gatewayPaymentId: { not: null },
        // Estorno só faz sentido em cobrança paga; os demais, na pendente.
        status: event === 'PAYMENT_REFUNDED' ? 'PAID' : 'PENDING',
        ...(number && { order: { number: Number(number) } }),
      },
      include: { order: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      console.error('Nenhuma cobrança do Asaas encontrada. Gere um Pix ou link de cartão na comanda primeiro.');
      process.exit(1);
    }

    const payload = {
      id: `evt_sim_${randomUUID()}`,
      event,
      dateCreated: new Date().toISOString(),
      payment: {
        object: 'payment',
        id: payment.gatewayPaymentId,
        externalReference: `order-payment:${payment.id}`,
        value: Number(payment.amount),
        billingType: payment.method === 'PIX' ? 'PIX' : 'CREDIT_CARD',
        status: STATUS[event] ?? 'PENDING',
        dueDate: ymd(payment.dueDate ?? new Date()),
        confirmedDate: event === 'PAYMENT_RECEIVED' ? ymd(new Date()) : null,
        invoiceUrl: payment.invoiceUrl,
      },
    };
    const response = await fetch(`${API}/webhooks/asaas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'asaas-access-token': env.ASAAS_WEBHOOK_TOKEN },
      body: JSON.stringify(payload),
    });
    console.log(`${event} → ${response.status} ${await response.text()}`);

    const after = await prisma.orderPayment.findUnique({ where: { id: payment.id }, include: { order: true } });
    console.log(`Comanda #${payment.order.number}: ${payment.order.status} → ${after.order.status} (pagamento ${payment.status} → ${after.status})`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
