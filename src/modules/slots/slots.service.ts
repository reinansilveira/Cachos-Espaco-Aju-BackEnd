import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { AppointmentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import {
  AuthPrincipal,
  hasRole,
} from '../auth/types/auth-principal.type';

export type SlotResult = { id: string; startsAt: Date };

export type SlotBatchResult = {
  created: SlotResult[];
  skipped: { startsAt: string; reason: string }[];
};

@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  public async create(
    dto: CreateSlotDto,
    actor?: AuthPrincipal,
  ): Promise<SlotResult | SlotBatchResult> {
    if (!dto.startsAt && !dto.slots) {
      throw new BadRequestException('Informe [startsAt] ou [slots].');
    }

    await this.assertCanManageProfessional(dto.professionalId, actor);
    const times = dto.slots ?? [dto.startsAt!];

    return times.length === 1
      ? this.createOne(dto.professionalId, times[0])
      : this.createMany(dto.professionalId, times);
  }

  public async findAvailable(
    professionalId: string,
    date: string,
    serviceId?: string,
  ): Promise<SlotResult[]> {
    const start = new Date(`${date}T00:00:00`);
    const end   = new Date(`${date}T23:59:59`);

    const slots = await this.prisma.timeSlot.findMany({
      where: {
        professionalId,
        available: true,
        startsAt: { gte: start, lte: end },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true },
    });

    if (!serviceId || slots.length === 0) return slots;
    return this.slotsThatFit(professionalId, serviceId, slots);
  }

  // Com o serviço escolhido, some o horário em que ele não cabe: passaria do
  // expediente ou bateria num atendimento que já ocupa o horário seguinte.
  private async slotsThatFit(
    professionalId: string,
    serviceId: string,
    slots: SlotResult[],
  ) {
    const link = await this.prisma.professionalService.findUnique({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      include: { service: { select: { duration: true } } },
    });
    const duration = link?.customDuration ?? link?.service.duration;
    if (!duration) return slots;

    const first = slots[0].startsAt;
    const last = new Date(slots[slots.length - 1].startsAt.getTime() + duration * 60_000);
    const day = salonClock(first);

    const [appointments, schedules] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          professionalId,
          status: {
            in: [
              AppointmentStatus.PENDING,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
            ],
          },
          scheduledAt: { lt: last },
          endsAt: { gt: first },
        },
        select: { scheduledAt: true, endsAt: true },
      }),
      this.prisma.schedule.findMany({
        where: {
          professionalId,
          active: true,
          OR: [
            { dayOfWeek: day.dayOfWeek, date: null },
            { date: { gte: day.dayStart, lt: day.dayEnd } },
          ],
        },
        select: { startTime: true, endTime: true, breakStart: true, breakEnd: true },
      }),
    ]);

    return slots.filter((slot) => {
      const startsAt = slot.startsAt;
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const from = salonClock(startsAt).time;
      const to = salonClock(endsAt).time;

      const fitsSchedule =
        schedules.length === 0 ||
        schedules.some(
          (schedule) =>
            from >= schedule.startTime &&
            to <= schedule.endTime &&
            to > from &&
            !(
              schedule.breakStart &&
              schedule.breakEnd &&
              from < schedule.breakEnd &&
              to > schedule.breakStart
            ),
        );
      const free = !appointments.some(
        (appointment) => appointment.scheduledAt < endsAt && appointment.endsAt > startsAt,
      );
      return fitsSchedule && free;
    });
  }

  public async delete(id: string, actor?: AuthPrincipal): Promise<void> {
    const slot = await this.prisma.timeSlot.findUnique({ where: { id } });

    if (!slot)           throw new NotFoundException('Slot não encontrado');
    if (!slot.available) throw new BadRequestException('Slot já está ocupado');
    await this.assertCanManageProfessional(slot.professionalId, actor);

    await this.prisma.timeSlot.delete({ where: { id } });
  }


  private async createOne(professionalId: string, rawStartsAt: string): Promise<SlotResult> {
    const startsAt  = new Date(rawStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Horário inválido');
    }

    const business = this.businessTime(startsAt);

    const schedules = await this.prisma.schedule.findMany({
      where: {
        professionalId,
        active: true,
        OR: [
          { dayOfWeek: business.dayOfWeek, date: null },
          { date: { gte: business.dayStart, lt: business.dayEnd } },
        ],
      },
    });

    const schedule = schedules.find((item) =>
      this.isWithinSchedule(business.time, item),
    );

    if (!schedule) {
      throw new BadRequestException(
        'Horário fora do expediente ou intervalo do profissional',
      );
    }

    const existing = await this.prisma.timeSlot.findUnique({
      where: { professionalId_startsAt: { professionalId, startsAt } },
    });

    if (existing) throw new ConflictException('Slot já existe neste horário');

    return this.prisma.timeSlot.create({
      data: { professionalId, startsAt },
      select: { id: true, startsAt: true },
    });
  }

  private async createMany(professionalId: string, times: string[]): Promise<SlotBatchResult> {
    const created: SlotResult[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];

    for (const startsAt of times) {
      try {
        const result = await this.createOne(professionalId, startsAt);
        created.push(result);
      } catch (err) {
        const reason = err instanceof HttpException
          ? err.message
          : 'Erro desconhecido';

        skipped.push({ startsAt, reason });
      }
    }

    return { created, skipped };
  }

  private async assertCanManageProfessional(
    professionalId: string,
    actor?: AuthPrincipal,
  ) {
    if (!actor || hasRole(actor, UserRole.ADMIN)) return;

    const professional = await this.prisma.professional.findUnique({
      where: { id: professionalId },
      select: { userId: true },
    });

    if (
      !professional ||
      !hasRole(actor, UserRole.PROFESSIONAL) ||
      professional.userId !== actor.sub
    ) {
      throw new ForbiddenException('Você não pode alterar os slots deste profissional');
    }
  }

  private businessTime(startsAt: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(startsAt);
    const value = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const date = `${value('year')}-${value('month')}-${value('day')}`;

    return {
      dayOfWeek: new Date(`${date}T12:00:00.000Z`).getUTCDay(),
      time: `${value('hour')}:${value('minute')}`,
      dayStart: new Date(`${date}T00:00:00.000Z`),
      dayEnd: new Date(
        new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000,
      ),
    } as const;
  }

  private isWithinSchedule(
    time: string,
    schedule: {
      startTime: string;
      endTime: string;
      breakStart: string | null;
      breakEnd: string | null;
    },
  ) {
    const inWorkHours = time >= schedule.startTime && time < schedule.endTime;
    const inBreak =
      schedule.breakStart &&
      schedule.breakEnd &&
      time >= schedule.breakStart &&
      time < schedule.breakEnd;
    return inWorkHours && !inBreak;
  }
}

// Horário de Aracaju (UTC-3, sem horário de verão), como nos agendamentos.
const SALON_OFFSET_MS = 3 * 3600_000;

function salonClock(instant: Date) {
  const local = new Date(instant.getTime() - SALON_OFFSET_MS);
  const key = local.toISOString().slice(0, 10);
  const dayStart = new Date(`${key}T00:00:00-03:00`);
  return {
    dayOfWeek: local.getUTCDay(),
    time: local.toISOString().slice(11, 16),
    dayStart,
    dayEnd: new Date(dayStart.getTime() + 86_400_000),
  };
}
