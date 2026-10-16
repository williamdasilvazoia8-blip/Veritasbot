import type { Prisma, PrismaClient, ScheduledMessage, ScheduleKind, Recurrence } from '@prisma/client';
import { safeJobId, type JobScheduler } from '../../../jobs/job-scheduler.js';
import type { AuditService } from '../../audit/audit-service.js';
import { nextOccurrence, parseLocal, type Occurrence } from '../domain/recurrence.js';

export function scheduleJobId(scheduleId: string, occurrenceKey: string): string {
  return safeJobId('sched', scheduleId, occurrenceKey);
}

export interface CreateScheduleInput {
  guildId: string;
  channelId: string;
  creatorId: string;
  kind: ScheduleKind;
  payload: Prisma.InputJsonValue;
  timezone: string;
  startLocal: string;
  recurrence: Recurrence;
  groupId?: string;
}

export type ScheduleResult =
  { ok: true; schedule: ScheduledMessage; next: Occurrence | null } | { ok: false; error: string };

/**
 * Ciclo de vida dos agendamentos. O PostgreSQL guarda a definição e a próxima
 * ocorrência; a fila só recebe o job da PRÓXIMA ocorrência (nunca meses de mensagens prontas).
 * Toda operação filtra por guildId.
 */
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobScheduler,
    private readonly audit: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Cria como RASCUNHO: só passa a valer após a pré-visualização e ativação. */
  async createDraft(input: CreateScheduleInput): Promise<ScheduleResult> {
    try {
      parseLocal(input.startLocal);
    } catch {
      return { ok: false, error: 'Data/hora inválida.' };
    }
    const next = nextOccurrence(input.startLocal, input.timezone, input.recurrence, this.now());
    if (!next) return { ok: false, error: 'Essa data/hora já passou.' };
    const schedule = await this.prisma.scheduledMessage.create({ data: { ...input, status: 'DRAFT' } });
    await this.audit.record({
      guildId: input.guildId,
      action: 'schedule.create',
      actorUserId: input.creatorId,
      targetId: schedule.id,
      metadata: {
        kind: input.kind,
        recurrence: input.recurrence,
        startLocal: input.startLocal,
        timezone: input.timezone,
      },
    });
    return { ok: true, schedule, next };
  }

  get(guildId: string, id: string): Promise<ScheduledMessage | null> {
    return this.prisma.scheduledMessage.findFirst({ where: { id, guildId } });
  }

  list(guildId: string): Promise<ScheduledMessage[]> {
    return this.prisma.scheduledMessage.findMany({
      where: { guildId, status: { in: ['DRAFT', 'ACTIVE', 'PAUSED', 'ERROR'] } },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'desc' }],
      take: 25,
    });
  }

  recentDeliveries(scheduleId: string) {
    return this.prisma.scheduledDelivery.findMany({
      where: { scheduledMessageId: scheduleId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  async activate(guildId: string, id: string, actorId: string): Promise<ScheduleResult> {
    const s = await this.get(guildId, id);
    if (!s) return { ok: false, error: 'Agendamento não encontrado.' };
    if (s.status === 'CANCELED' || s.status === 'COMPLETED')
      return { ok: false, error: 'Este agendamento já foi encerrado.' };
    const next = nextOccurrence(s.startLocal, s.timezone, s.recurrence, this.now());
    if (!next) return { ok: false, error: 'Não há ocorrências futuras para este agendamento.' };
    const updated = await this.prisma.scheduledMessage.update({
      where: { id },
      data: { status: 'ACTIVE', nextRunAt: next.runAt, nextOccurrenceKey: next.key, lastError: null },
    });
    await this.jobs.schedule('schedule-delivery', scheduleJobId(id, next.key), next.runAt, {
      scheduleId: id,
      occurrenceKey: next.key,
    });
    await this.audit.record({
      guildId,
      action: s.status === 'PAUSED' || s.status === 'ERROR' ? 'schedule.resume' : 'schedule.activate',
      actorUserId: actorId,
      targetId: id,
    });
    return { ok: true, schedule: updated, next };
  }

  /** Ativa todos os rascunhos de um grupo (ex.: os horários do Angelus). */
  async activateGroup(guildId: string, groupId: string, actorId: string): Promise<ScheduleResult[]> {
    const drafts = await this.prisma.scheduledMessage.findMany({
      where: { guildId, groupId, status: 'DRAFT' },
      orderBy: { startLocal: 'asc' },
    });
    const results: ScheduleResult[] = [];
    for (const d of drafts) results.push(await this.activate(guildId, d.id, actorId));
    return results;
  }

  /** Descarta todos os rascunhos de um grupo. */
  async cancelGroup(guildId: string, groupId: string, actorId: string): Promise<number> {
    const drafts = await this.prisma.scheduledMessage.findMany({
      where: { guildId, groupId, status: 'DRAFT' },
    });
    for (const d of drafts) await this.cancel(guildId, d.id, actorId);
    return drafts.length;
  }

  async pause(guildId: string, id: string, actorId: string): Promise<ScheduleResult> {
    return this.stop(guildId, id, actorId, 'PAUSED', 'schedule.pause');
  }

  async cancel(guildId: string, id: string, actorId: string): Promise<ScheduleResult> {
    return this.stop(guildId, id, actorId, 'CANCELED', 'schedule.cancel');
  }

  private async stop(
    guildId: string,
    id: string,
    actorId: string,
    status: 'PAUSED' | 'CANCELED',
    action: string,
  ): Promise<ScheduleResult> {
    const s = await this.get(guildId, id);
    if (!s) return { ok: false, error: 'Agendamento não encontrado.' };
    if (s.status === 'CANCELED' || s.status === 'COMPLETED')
      return { ok: false, error: 'Este agendamento já foi encerrado.' };
    if (s.nextOccurrenceKey) await this.jobs.cancel(scheduleJobId(id, s.nextOccurrenceKey));
    const updated = await this.prisma.scheduledMessage.update({
      where: { id },
      data: { status, nextRunAt: null, nextOccurrenceKey: null },
    });
    await this.audit.record({ guildId, action, actorUserId: actorId, targetId: id });
    return { ok: true, schedule: updated, next: null };
  }

  /** Edita e, se ativo, reprograma. O job antigo fica obsoleto (chave diferente) e é cancelado. */
  async edit(
    guildId: string,
    id: string,
    actorId: string,
    patch: {
      channelId?: string;
      payload?: Prisma.InputJsonValue;
      startLocal?: string;
      timezone?: string;
      recurrence?: Recurrence;
    },
  ): Promise<ScheduleResult> {
    const s = await this.get(guildId, id);
    if (!s) return { ok: false, error: 'Agendamento não encontrado.' };
    if (s.status === 'CANCELED' || s.status === 'COMPLETED')
      return { ok: false, error: 'Este agendamento já foi encerrado.' };
    const startLocal = patch.startLocal ?? s.startLocal;
    const timezone = patch.timezone ?? s.timezone;
    const recurrence = patch.recurrence ?? s.recurrence;
    try {
      parseLocal(startLocal);
    } catch {
      return { ok: false, error: 'Data/hora inválida.' };
    }
    const next = nextOccurrence(startLocal, timezone, recurrence, this.now());
    if (!next) return { ok: false, error: 'Com essa alteração não há ocorrências futuras.' };
    if (s.nextOccurrenceKey) await this.jobs.cancel(scheduleJobId(id, s.nextOccurrenceKey));
    const active = s.status === 'ACTIVE';
    const updated = await this.prisma.scheduledMessage.update({
      where: { id },
      data: {
        ...patch,
        ...(active ? { nextRunAt: next.runAt, nextOccurrenceKey: next.key } : {}),
      },
    });
    if (active)
      await this.jobs.schedule('schedule-delivery', scheduleJobId(id, next.key), next.runAt, {
        scheduleId: id,
        occurrenceKey: next.key,
      });
    await this.audit.record({
      guildId,
      action: 'schedule.edit',
      actorUserId: actorId,
      targetId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return { ok: true, schedule: updated, next };
  }

  /**
   * Após reinício/implantação: garante um job para cada agendamento ativo.
   * Ocorrências perdidas dentro da tolerância são entregues com atraso; além dela,
   * são registradas como SKIPPED e o agendamento avança.
   */
  async reconcile(graceMs: number): Promise<{ enqueued: number; skipped: number }> {
    const now = this.now();
    const active = await this.prisma.scheduledMessage.findMany({ where: { status: 'ACTIVE' } });
    let enqueued = 0;
    let skipped = 0;
    for (const s of active) {
      let runAt = s.nextRunAt;
      let key = s.nextOccurrenceKey;
      if (!runAt || !key) {
        const n = nextOccurrence(s.startLocal, s.timezone, s.recurrence, now);
        if (!n) {
          await this.prisma.scheduledMessage.update({ where: { id: s.id }, data: { status: 'COMPLETED' } });
          continue;
        }
        ({ runAt, key } = n);
        await this.prisma.scheduledMessage.update({
          where: { id: s.id },
          data: { nextRunAt: runAt, nextOccurrenceKey: key },
        });
      }
      if (now.getTime() - runAt.getTime() > graceMs) {
        await this.prisma.scheduledDelivery.upsert({
          where: { scheduledMessageId_occurrenceKey: { scheduledMessageId: s.id, occurrenceKey: key } },
          update: {},
          create: {
            scheduledMessageId: s.id,
            occurrenceKey: key,
            status: 'SKIPPED',
            error: 'Perdido durante indisponibilidade (fora da tolerância)',
          },
        });
        skipped++;
        const n = await this.advance(s.id, key, runAt);
        if (n) {
          await this.jobs.schedule('schedule-delivery', scheduleJobId(s.id, n.key), n.runAt, {
            scheduleId: s.id,
            occurrenceKey: n.key,
          });
          enqueued++;
        }
        continue;
      }
      await this.jobs.schedule('schedule-delivery', scheduleJobId(s.id, key), runAt, {
        scheduleId: s.id,
        occurrenceKey: key,
      });
      enqueued++;
    }
    return { enqueued, skipped };
  }

  /**
   * Avança para a ocorrência seguinte de forma condicional (só se a atual ainda for
   * `occurrenceKey`), evitando corrida com edições. Retorna a nova ocorrência ou null.
   */
  async advance(scheduleId: string, occurrenceKey: string, occurredAt: Date): Promise<Occurrence | null> {
    const s = await this.prisma.scheduledMessage.findUnique({ where: { id: scheduleId } });
    if (!s) return null;
    const after = new Date(Math.max(occurredAt.getTime(), this.now().getTime() - 1));
    const next =
      s.recurrence === 'ONCE' ? null : nextOccurrence(s.startLocal, s.timezone, s.recurrence, after);
    const res = await this.prisma.scheduledMessage.updateMany({
      where: { id: scheduleId, nextOccurrenceKey: occurrenceKey, status: 'ACTIVE' },
      data: next
        ? { nextRunAt: next.runAt, nextOccurrenceKey: next.key }
        : { status: 'COMPLETED', nextRunAt: null, nextOccurrenceKey: null },
    });
    return res.count > 0 ? next : null;
  }
}
