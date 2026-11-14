// Dados de demonstração para a dona testar o painel: clientes, agenda da
// semana passada e da próxima, comandas em todos os estados, avaliações e
// movimentos de estoque. Roda depois do `seed.js` e só uma vez: grava a
// configuração `demo.seeded`, então apagar os dados não faz eles voltarem.
// Ligado no container por SEED_DEMO=true.
//
// Clientes de demonstração têm e-mail em @exemplo.com e a observação
// "Cliente de demonstração", para a dona saber o que apagar depois.

const { PrismaClient } = require('@prisma/client');

const DEMO_NOTE = 'Cliente de demonstração';
const DEMO_KEY = 'demo.seeded';
const OFFSET = '-03:00'; // Aracaju, sem horário de verão

const CLIENTS = [
  ['Ana Beatriz Souza', '79991000001'],
  ['Carla Menezes', '79991000002'],
  ['Juliana Prado', '79991000003'],
  ['Mariana Lima', '79991000004'],
  ['Fernanda Rocha', '79991000005'],
  ['Priscila Andrade', '79991000006'],
  ['Camila Santos', '79991000007'],
  ['Rebeca Nunes', '79991000008'],
];

const OPEN_DAYS = [2, 3, 4, 5, 6]; // terça a sábado

function salonToday(now = new Date()) {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isOpen(day) {
  return OPEN_DAYS.includes(new Date(`${day}T12:00:00Z`).getUTCDay());
}

// Dias de funcionamento a partir de hoje: passo -1 para trás, +1 para frente.
function openDays(today, step, count) {
  const days = [];
  for (let d = addDays(today, step); days.length < count; d = addDays(d, step)) {
    if (isOpen(d)) days.push(d);
  }
  return days;
}

const at = (day, time) => new Date(`${day}T${time}:00${OFFSET}`);
const minutes = (date, n) => new Date(date.getTime() + n * 60_000);
const cents = (n) => Math.round(Number(n) * 100);
const money = (c) => (c / 100).toFixed(2);

async function main() {
  const prisma = new PrismaClient();
  try {
    const already = await prisma.configuration.findUnique({ where: { key: DEMO_KEY } });
    if (already) {
      console.log('Demonstração já criada, nada a fazer.');
      return;
    }

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const pros = await prisma.professional.findMany({ include: { user: true } });
    const pro = (first) => pros.find((p) => p.user.name.startsWith(first));
    const linnda = pro('Linnda');
    const sil = pro('Sil');
    const services = await prisma.service.findMany();
    const service = (name) => services.find((s) => s.name === name);
    const products = await prisma.product.findMany();
    const product = (name) => products.find((p) => p.name === name);
    if (!admin || !linnda || !sil || !service('Corte') || !product('Óleo finalizador')) {
      console.log('Rode o seed.js antes da demonstração.');
      return;
    }

    const clients = {};
    for (const [name, phone] of CLIENTS) {
      const first = name.split(' ')[0].toLowerCase();
      const user = await prisma.user.create({
        data: {
          name,
          phone,
          email: `${first}.demo@exemplo.com`,
          role: 'CLIENT',
          roleAssignments: { create: { role: 'CLIENT' } },
        },
      });
      clients[name.split(' ')[0]] = await prisma.client.create({
        data: { userId: user.id, notes: DEMO_NOTE },
      });
    }

    const today = salonToday();
    const past = openDays(today, -1, 6); // past[0] = último dia aberto
    const next = openDays(today, 1, 3);

    // Mantém o saldo igual ao StockService: baixa com movimento e saldo final.
    async function moveStock(tx, productId, type, delta, extra = {}) {
      const p = await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: { increment: delta } },
      });
      await tx.stockMovement.create({
        data: {
          productId,
          type,
          quantity: delta,
          balanceAfter: p.stockQuantity,
          createdById: admin.id,
          ...extra,
        },
      });
    }

    async function appointment({ client, pro, svc, day, time, status, notes, cancelReason }) {
      const scheduledAt = at(day, time);
      const s = service(svc);
      const appt = await prisma.appointment.create({
        data: {
          clientId: clients[client].id,
          professionalId: pro.id,
          serviceId: s.id,
          createdById: admin.id,
          scheduledAt,
          endsAt: minutes(scheduledAt, s.duration),
          duration: s.duration,
          price: s.price,
          status,
          notes: notes ?? null,
          cancelReason: cancelReason ?? null,
          startedAt: status === 'COMPLETED' ? scheduledAt : null,
          completedAt: status === 'COMPLETED' ? minutes(scheduledAt, s.duration) : null,
          createdAt: minutes(scheduledAt, -3 * 24 * 60),
        },
      });

      // Horário futuro ocupa o slot da agenda, como num agendamento normal.
      if (scheduledAt > new Date() && ['PENDING', 'CONFIRMED'].includes(status)) {
        await prisma.timeSlot.upsert({
          where: { professionalId_startsAt: { professionalId: pro.id, startsAt: scheduledAt } },
          update: { available: false, appointmentId: appt.id },
          create: {
            professionalId: pro.id,
            startsAt: scheduledAt,
            available: false,
            appointmentId: appt.id,
          },
        });
      }
      return { appt, s };
    }

    // Comanda com serviço e produtos. `payments`: [{ method, cents?, isDeposit?, at }]
    async function order({ client, appt, s, pro, extras = [], status, payments = [], openedAt }) {
      return prisma.$transaction(async (tx) => {
        const items = [];
        if (s) {
          items.push({
            type: 'SERVICE',
            serviceId: s.id,
            professionalId: pro.id,
            description: s.name,
            quantity: 1,
            unitPrice: cents(s.price),
          });
        }
        for (const [name, quantity] of extras) {
          const p = product(name);
          items.push({
            type: 'PRODUCT',
            productId: p.id,
            description: p.name,
            quantity,
            unitPrice: cents(p.salePrice),
          });
        }
        const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
        const closed = status !== 'OPEN';
        const lastPayment = payments.length ? payments[payments.length - 1].at : null;

        const created = await tx.order.create({
          data: {
            clientId: clients[client].id,
            appointmentId: appt?.id ?? null,
            status,
            subtotal: money(subtotal),
            discount: '0.00',
            total: money(subtotal),
            openedById: admin.id,
            createdAt: openedAt,
            closedAt: closed ? minutes(openedAt, s?.duration ?? 15) : null,
            paidAt: status === 'PAID' ? lastPayment : null,
            items: {
              create: items.map((i) => ({
                ...i,
                unitPrice: money(i.unitPrice),
                total: money(i.unitPrice * i.quantity),
                createdAt: openedAt,
              })),
            },
          },
        });

        // Fechar a comanda é o que baixa os produtos.
        if (closed) {
          for (const i of items.filter((x) => x.type === 'PRODUCT')) {
            await moveStock(tx, i.productId, 'SALE', -i.quantity, {
              orderId: created.id,
              reason: `Comanda #${created.number}`,
              createdAt: minutes(openedAt, s?.duration ?? 15),
            });
          }
        }

        let paid = 0;
        for (const pay of payments) {
          const amount = pay.cents ?? subtotal - paid;
          paid += amount;
          await tx.orderPayment.create({
            data: {
              orderId: created.id,
              method: pay.method,
              isDeposit: Boolean(pay.isDeposit),
              status: 'PAID',
              amount: money(amount),
              paidAt: pay.at,
              createdById: admin.id,
              createdAt: pay.at,
              notes: pay.isDeposit ? 'Sinal pago no site' : null,
            },
          });
        }
        return created;
      });
    }

    const deposit = (s) => Math.round(cents(s.price) * 0.2);

    // ---------- semana passada: atendidas e pagas ----------
    let a = await appointment({ client: 'Ana', pro: linnda, svc: 'Corte', day: past[5], time: '10:00', status: 'COMPLETED' });
    await order({ client: 'Ana', ...a, pro: linnda, extras: [['Creme de pentear definição', 1]], status: 'PAID', openedAt: a.appt.scheduledAt, payments: [{ method: 'PIX', at: a.appt.endsAt }] });
    await prisma.review.create({ data: { appointmentId: a.appt.id, clientId: clients.Ana.id, professionalId: linnda.id, rating: 5, comment: 'Amei o corte, meus cachos nunca ficaram tão definidos!', createdAt: minutes(a.appt.endsAt, 120) } });

    a = await appointment({ client: 'Carla', pro: linnda, svc: 'Hidratação Capilar', day: past[4], time: '14:00', status: 'COMPLETED' });
    await order({ client: 'Carla', ...a, pro: linnda, status: 'PAID', openedAt: a.appt.scheduledAt, payments: [{ method: 'DEBIT_CARD', at: a.appt.endsAt }] });
    await prisma.review.create({ data: { appointmentId: a.appt.id, clientId: clients.Carla.id, professionalId: linnda.id, rating: 5, comment: 'Atendimento maravilhoso, ambiente lindo.', createdAt: minutes(a.appt.endsAt, 60) } });

    a = await appointment({ client: 'Juliana', pro: sil, svc: 'Maquiagem', day: past[3], time: '09:00', status: 'COMPLETED', notes: 'Make para formatura' });
    await order({ client: 'Juliana', ...a, pro: sil, status: 'PAID', openedAt: a.appt.scheduledAt, payments: [{ method: 'CREDIT_CARD', at: a.appt.endsAt }] });
    await prisma.review.create({ data: { appointmentId: a.appt.id, clientId: clients.Juliana.id, professionalId: sil.id, rating: 5, comment: 'A make durou a noite toda. Sil é incrível!', createdAt: minutes(a.appt.endsAt, 600) } });

    a = await appointment({ client: 'Mariana', pro: linnda, svc: 'Corte + Hidronutrição', day: past[2], time: '15:00', status: 'COMPLETED' });
    await order({
      client: 'Mariana', ...a, pro: linnda, extras: [['Gelatina modeladora', 1]], status: 'PAID', openedAt: a.appt.scheduledAt,
      payments: [
        { method: 'PIX', cents: deposit(a.s), isDeposit: true, at: minutes(a.appt.scheduledAt, -3 * 24 * 60) },
        { method: 'CASH', at: a.appt.endsAt },
      ],
    });
    await prisma.review.create({ data: { appointmentId: a.appt.id, clientId: clients.Mariana.id, professionalId: linnda.id, rating: 4, comment: 'Gostei muito! Só atrasou um pouquinho.', createdAt: minutes(a.appt.endsAt, 300) } });

    await appointment({ client: 'Fernanda', pro: linnda, svc: 'Corte', day: past[1], time: '11:00', status: 'CANCELLED', cancelReason: 'Cliente pediu para remarcar' });
    await appointment({ client: 'Priscila', pro: sil, svc: 'Finalização M', day: past[0], time: '16:00', status: 'NO_SHOW' });

    // Atendida mas ainda não paga: comanda fechada aguardando pagamento.
    a = await appointment({ client: 'Camila', pro: linnda, svc: 'Nutrição Capilar', day: past[0], time: '10:00', status: 'COMPLETED' });
    await order({ client: 'Camila', ...a, pro: linnda, extras: [['Óleo finalizador', 1]], status: 'AWAITING_PAYMENT', openedAt: a.appt.scheduledAt });

    // ---------- hoje, se o salão abre ----------
    if (isOpen(today)) {
      a = await appointment({ client: 'Priscila', pro: linnda, svc: 'Corte + Protocolo Antiporosidade', day: today, time: '14:00', status: 'CONFIRMED' });
      await order({ client: 'Priscila', ...a, pro: linnda, status: 'OPEN', openedAt: minutes(a.appt.scheduledAt, -24 * 60), payments: [{ method: 'PIX', cents: deposit(a.s), isDeposit: true, at: minutes(a.appt.scheduledAt, -24 * 60) }] });
      await appointment({ client: 'Camila', pro: sil, svc: 'Finalização G', day: today, time: '16:00', status: 'PENDING' });
    }

    // ---------- próximos dias ----------
    a = await appointment({ client: 'Rebeca', pro: linnda, svc: 'Corte', day: next[0], time: '09:00', status: 'CONFIRMED' });
    await order({ client: 'Rebeca', ...a, pro: linnda, status: 'OPEN', openedAt: minutes(a.appt.scheduledAt, -2 * 24 * 60), payments: [{ method: 'PIX', cents: deposit(a.s), isDeposit: true, at: minutes(a.appt.scheduledAt, -2 * 24 * 60) }] });

    await appointment({ client: 'Ana', pro: sil, svc: 'Maquiagem', day: next[0], time: '14:00', status: 'PENDING' });

    a = await appointment({ client: 'Juliana', pro: linnda, svc: 'Hidratação Capilar', day: next[1], time: '10:00', status: 'CONFIRMED' });
    await order({ client: 'Juliana', ...a, pro: linnda, status: 'OPEN', openedAt: minutes(a.appt.scheduledAt, -24 * 60), payments: [{ method: 'PIX', cents: deposit(a.s), isDeposit: true, at: minutes(a.appt.scheduledAt, -24 * 60) }] });

    await appointment({ client: 'Carla', pro: linnda, svc: 'Corte', day: next[1], time: '15:00', status: 'PENDING' });
    await appointment({ client: 'Mariana', pro: sil, svc: 'Penteado', day: next[2], time: '09:00', status: 'CONFIRMED', notes: 'Penteado para casamento' });

    // Venda de balcão, sem atendimento, ainda aberta.
    await order({ client: 'Fernanda', extras: [['Creme de pentear definição', 2], ['Óleo finalizador', 1]], status: 'OPEN', openedAt: new Date() });

    // ---------- estoque ----------
    await prisma.$transaction(async (tx) => {
      await moveStock(tx, product('Óleo finalizador').id, 'IN', 6, { reason: 'Reposição do fornecedor', unitCost: product('Óleo finalizador').costPrice });
      await moveStock(tx, product('Máscara de hidratação 1kg').id, 'INTERNAL_USE', -1, { reason: 'Hidratações da semana' });
      await moveStock(tx, product('Luvas descartáveis (caixa)').id, 'INTERNAL_USE', -1, { reason: 'Uso no lavatório' });
    });

    // Nota média das profissionais a partir das avaliações.
    for (const p of [linnda, sil]) {
      const stats = await prisma.review.aggregate({ where: { professionalId: p.id }, _avg: { rating: true }, _count: true });
      await prisma.professional.update({
        where: { id: p.id },
        data: { rating: (stats._avg.rating ?? 0).toFixed(1), totalReviews: stats._count },
      });
    }

    await prisma.configuration.create({
      data: {
        key: DEMO_KEY,
        value: new Date().toISOString(),
        description: 'Dados de demonstração já criados (scripts/seed-demo.js).',
        category: 'sistema',
      },
    });

    console.log(`Demonstração criada: ${CLIENTS.length} clientes, agenda de ${past[5]} a ${next[2]}, comandas e estoque.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // A demonstração nunca pode impedir a API de subir.
  console.error('Falha ao criar a demonstração:', error.message);
});
