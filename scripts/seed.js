// Dados iniciais do salão para desenvolvimento.
//
//   node scripts/seed.js
//
// Cria (ou atualiza) a conta da dona com SEED_ADMIN_EMAIL e
// SEED_ADMIN_PASSWORD do `.env`, os serviços do Instagram do salão e alguns
// produtos de exemplo. Pode rodar mais de uma vez.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Em produção não há `.env`: as variáveis vêm do ambiente.
const envFile = path.join(__dirname, '..', '.env');
const env = {
  ...process.env,
  ...(fs.existsSync(envFile)
    ? Object.fromEntries(
        fs
          .readFileSync(envFile, 'utf8')
          .split('\n')
          .filter((line) => line.includes('=') && !line.startsWith('#'))
          .map((line) => [
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1).trim(),
          ]),
      )
    : {}),
};

// Catálogo do Trinks do salão (trinks.com/espaco-cachos-aju), novembro de 2026.
// Duração é o tempo real do atendimento, não o intervalo de 1h da agenda.
const SERVICES = [
  [
    'Corte',
    'Design de Corte',
    90,
    140,
    'Design de corte personalizado para o seu objetivo, com higienização, fitagem e secagem difusora.',
  ],
  [
    'Corte + Protocolo Antiporosidade',
    'Combos',
    150,
    240,
    'Design de corte com tratamento para porosidade, lavagem, finalização e secagem.',
  ],
  [
    'Corte + Hidronutrição',
    'Combos',
    120,
    220,
    'Design de corte com hidratação e nutrição juntas, lavagem, fitagem e secagem.',
  ],
  [
    'Hidratação Capilar',
    'Cronograma Capilar',
    60,
    107,
    'Hidratação para cabelos secos e sem vida, com Toctus.',
  ],
  [
    'Nutrição Capilar',
    'Cronograma Capilar',
    60,
    107,
    'Nutrição para cabelos ressecados, com Toctus.',
  ],
  [
    'Reconstrução Capilar',
    'Cronograma Capilar',
    60,
    107,
    'Reconstrução capilar com Toctus.',
  ],
  [
    'Protocolo Antiporosidade',
    'Cronograma Capilar',
    60,
    160,
    'Para cabelos porosos: secos, ásperos e que parecem não absorver tratamento.',
  ],
  [
    'Hidronutrição Capilar',
    'Tratamentos',
    60,
    130,
    'Hidratação e nutrição juntas para cabelos secos, ressecados e sem brilho.',
  ],
  [
    'Protocolo HNR',
    'Tratamentos',
    60,
    130,
    'Hidratação, nutrição e reconstrução em um só tratamento.',
  ],
  [
    'Nutri Glow',
    'Tratamentos',
    60,
    130,
    'Nutrição com a linha Nutri Glow da Cadiveu.',
  ],
  [
    'Blonde Reconstructor',
    'Tratamentos',
    60,
    130,
    'Reconstrução potente para cabelos com cor, mechas ou elásticos.',
  ],
  [
    'Protocolo Detox Terrena',
    'Terapia Capilar',
    120,
    200,
    'Detox profundo com linha naturalista: shampoo, esfoliante, tônico e balm.',
  ],
  [
    'Ritual de Argiloterapia',
    'Terapia Capilar',
    120,
    200,
    'Argila no couro cabeludo contra oleosidade, caspa, descamação e coceira.',
  ],
  [
    'Sinergia de Óleos',
    'Terapia Capilar',
    120,
    200,
    'Blend de óleos essenciais e vegetais personalizado para o seu couro cabeludo.',
  ],
  [
    'Terapia de Alta Frequência',
    'Terapia Capilar',
    120,
    200,
    'Estímulo eletrostático indolor que ativa a circulação e revitaliza a raiz.',
  ],
  [
    'Avaliação e Teste de Mechas',
    'Cor',
    60,
    50,
    'Avaliação e teste para ruivo, iluminado, loiro, cobertura de brancos e fantasia.',
  ],
  [
    'Banho de Luz',
    'Cor',
    150,
    180,
    'Tonalização para reavivar ou escurecer as mechas, com tratamento e finalização.',
  ],
  [
    'Cobertura de Brancos',
    'Cor',
    150,
    180,
    'Retoque de raiz com tonalizante ou coloração, para quem já faz com a gente.',
  ],
  [
    'Retoque de Raiz Ruivo',
    'Cor',
    150,
    180,
    'Retoque do ruivo com tonalização do comprimento, para quem já faz com a gente.',
  ],
  [
    'Finalização PP',
    'Finalizações',
    60,
    60,
    'Lavagem, fitagem e secagem para cabelos curtinhos, até a orelha.',
  ],
  [
    'Finalização P',
    'Finalizações',
    60,
    70,
    'Lavagem, fitagem e secagem para cabelos até o ombro.',
  ],
  [
    'Finalização M',
    'Finalizações',
    60,
    80,
    'Lavagem, fitagem e secagem para cabelos até o meio das costas.',
  ],
  [
    'Finalização G',
    'Finalizações',
    60,
    90,
    'Lavagem, fitagem e secagem para cabelos até a cintura.',
  ],
  [
    'Finalização GG',
    'Finalizações',
    60,
    100,
    'Lavagem, fitagem e secagem para cabelos abaixo da cintura ou com muito volume.',
  ],
  [
    'Penteado',
    'Penteados',
    90,
    110,
    'Lavagem, fitagem estruturada e secagem. Babyliss no cabelo todo muda valor e tempo.',
  ],
  [
    'Maquiagem',
    'Maquiagem',
    90,
    110,
    'Maquiagem profissional para casamentos, formaturas, fotos e outras ocasiões.',
  ],
].map(([name, category, duration, price, description], index) => ({
  name,
  category,
  duration,
  price,
  description,
  order: index + 1,
}));

// Equipe do Trinks. Linnda cuida de corte, cor e tratamentos; Sil de make,
// penteados e finalizações. Os e-mails são de teste: troque pelos reais.
const TEAM = [
  {
    name: 'Linnda Lys',
    email: 'linnda@cachosaju.local',
    avatar: '/salao/equipe-linnda.jpg',
    specialty: 'Cabeleireira & Colorista',
    bio: 'Expert em crespos, ondas e cachos. Design de corte, cor e terapia capilar com escuta e cuidado.',
    categories: [
      'Design de Corte',
      'Combos',
      'Cronograma Capilar',
      'Tratamentos',
      'Terapia Capilar',
      'Cor',
      'Finalizações',
    ],
  },
  {
    name: 'Sil Costa',
    email: 'sil@cachosaju.local',
    avatar: '/salao/equipe-sil.jpg',
    specialty: 'Maquiadora, cabeleireira e penteadista',
    bio: 'Make e penteados para casamentos, formaturas e fotos, valorizando a textura natural.',
    categories: [
      'Maquiagem',
      'Penteados',
      'Finalizações',
      'Cronograma Capilar',
      'Tratamentos',
    ],
  },
];

// Terça a sexta das 9h às 18h; sábado das 8h às 18h (domingo e segunda fechado).
const WEEK = [
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 6, startTime: '08:00', endTime: '18:00' },
];
const SLOT_DAYS = 28;

const PRODUCTS = [
  {
    name: 'Creme de pentear definição',
    brand: 'Linha profissional',
    type: 'SALE',
    salePrice: 59.9,
    costPrice: 32,
    initial: 12,
    minStock: 3,
  },
  {
    name: 'Gelatina modeladora',
    brand: 'Linha profissional',
    type: 'SALE',
    salePrice: 49.9,
    costPrice: 26,
    initial: 8,
    minStock: 3,
  },
  {
    name: 'Óleo finalizador',
    brand: 'Linha profissional',
    type: 'SALE',
    salePrice: 39.9,
    costPrice: 18,
    initial: 2,
    minStock: 3,
  },
  {
    name: 'Máscara de hidratação 1kg',
    brand: 'Linha profissional',
    type: 'INTERNAL_USE',
    costPrice: 89,
    initial: 4,
    minStock: 1,
  },
  {
    name: 'Luvas descartáveis (caixa)',
    brand: null,
    type: 'INTERNAL_USE',
    costPrice: 35,
    initial: 3,
    minStock: 1,
  },
];

async function main() {
  const email = env.SEED_ADMIN_EMAIL;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      'Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env ou no ambiente.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, 10);
    const admin = await prisma.user.upsert({
      where: { email },
      update: { password: hash, role: 'ADMIN', active: true },
      create: {
        email,
        password: hash,
        name: 'Espaço Cachos Aju',
        role: 'ADMIN',
        passwordSetAt: new Date(),
      },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: admin.id, role: 'ADMIN' } },
      update: {},
      create: { userId: admin.id, role: 'ADMIN' },
    });

    for (const service of SERVICES) {
      const existing = await prisma.service.findFirst({
        where: { name: service.name },
      });
      if (!existing) await prisma.service.create({ data: service });
    }

    for (const { initial, ...product } of PRODUCTS) {
      const existing = await prisma.product.findFirst({
        where: { name: product.name },
      });
      if (existing) continue;
      await prisma.product.create({
        data: {
          ...product,
          stockQuantity: initial,
          movements: {
            create: {
              type: 'IN',
              quantity: initial,
              balanceAfter: initial,
              unitCost: product.costPrice,
              reason: 'Estoque inicial',
              createdById: admin.id,
            },
          },
        },
      });
    }

    const slots = await seedTeam(prisma);

    console.log(
      `Conta da dona: ${email} (senha em SEED_ADMIN_PASSWORD no .env)`,
    );
    console.log(
      `${SERVICES.length} serviços, ${TEAM.length} profissionais, ${slots} horários e ${PRODUCTS.length} produtos garantidos.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function seedTeam(prisma) {
  const services = await prisma.service.findMany();
  let slots = 0;

  for (const member of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: member.email },
      // Foto de perfil do Instagram dela, servida pelo site (public/salao).
      update: { avatar: member.avatar },
      create: {
        email: member.email,
        name: member.name,
        role: 'PROFESSIONAL',
        avatar: member.avatar,
      },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: user.id, role: 'PROFESSIONAL' } },
      update: {},
      create: { userId: user.id, role: 'PROFESSIONAL' },
    });
    const professional = await prisma.professional.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, specialty: member.specialty, bio: member.bio },
    });

    for (const service of services.filter((item) =>
      member.categories.includes(item.category),
    )) {
      await prisma.professionalService.upsert({
        where: {
          professionalId_serviceId: {
            professionalId: professional.id,
            serviceId: service.id,
          },
        },
        update: {},
        create: { professionalId: professional.id, serviceId: service.id },
      });
    }

    const hasSchedule = await prisma.schedule.count({
      where: { professionalId: professional.id },
    });
    if (!hasSchedule) {
      await prisma.schedule.createMany({
        data: WEEK.map((day) => ({ ...day, professionalId: professional.id })),
      });
    }

    const result = await prisma.timeSlot.createMany({
      data: upcomingSlots().map((startsAt) => ({
        professionalId: professional.id,
        startsAt,
      })),
      skipDuplicates: true,
    });
    slots += result.count;
  }
  return slots;
}

// Horários de hora em hora, no fuso de Aracaju (UTC-3, sem horário de verão).
function upcomingSlots(now = new Date()) {
  const slots = [];
  for (let offset = 0; offset < SLOT_DAYS; offset += 1) {
    const day = new Date(now.getTime() - 3 * 3600_000 + offset * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    const week = WEEK.find((item) => item.dayOfWeek === day.getUTCDay());
    if (!week) continue;
    const start = Number(week.startTime.slice(0, 2));
    const end = Number(week.endTime.slice(0, 2));
    for (let hour = start; hour < end; hour += 1) {
      const startsAt = new Date(
        `${key}T${String(hour).padStart(2, '0')}:00:00-03:00`,
      );
      if (startsAt > now) slots.push(startsAt);
    }
  }
  return slots;
}

main();
