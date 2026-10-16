import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type ScheduledMessage } from '@prisma/client';
import type { Logger } from '../../../shared/logger.js';
import { scheduleJobId, type ScheduleService } from './schedule-service.js';
import type { JobScheduler } from '../../../jobs/job-scheduler.js';
import { SendError, type MessageSender, type OutgoingMessage } from './types.js';

export type DeliveryOutcome = 'delivered' | 'stale' | 'already-done' | 'permanent-failure';

/** Monta a mensagem de uma ocorrência (texto fixo ou modelo dinâmico como a liturgia do dia). */
export interface MessageRenderer {
  render(schedule: ScheduledMessage, occurrenceKey: string, attempt: number): Promise<OutgoingMessage[]>;
}

/**
 * Entrega "efetivamente uma vez": chave única (agendamento, ocorrência) no banco +
 * nonce do Discord para descartar reenvios rápidos. Uma entrega 100% atômica não é
 * possível sem transação do lado do Discord: se o processo cair entre o envio e o
 * registro, a nova tentativa usa o mesmo nonce (deduplicado pelo Discord por alguns
 * minutos) — documentado em docs/architecture.md.
 */
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly schedules: ScheduleService,
    private readonly jobs: JobScheduler,
    private readonly sender: MessageSender,
    private readonly renderer: MessageRenderer,
    private readonly opts: {
      logger?: Logger;
      onPermanentFailure?: (s: ScheduledMessage, error: string) => Promise<void>;
    } = {},
  ) {}

  async deliver(scheduleId: string, occurrenceKey: string): Promise<DeliveryOutcome> {
    const schedule = await this.prisma.scheduledMessage.findUnique({ where: { id: scheduleId } });
    if (!schedule || schedule.status !== 'ACTIVE' || schedule.nextOccurrenceKey !== occurrenceKey)
      return 'stale';

    const delivery = await this.claim(scheduleId, occurrenceKey);
    if (delivery.status === 'DELIVERED' || delivery.status === 'SKIPPED' || delivery.status === 'FAILED') {
      // Já resolvida (ex.: o avanço falhou após entregar). Apenas avança.
      await this.advanceAndEnqueue(schedule, occurrenceKey);
      return 'already-done';
    }

    const now = new Date();
    await this.prisma.scheduledMessage.update({ where: { id: scheduleId }, data: { lastAttemptAt: now } });
    try {
      const messages = await this.renderer.render(schedule, occurrenceKey, delivery.attempts);
      // Anúncios em várias mensagens: retoma da primeira parte ainda não entregue.
      const ids = delivery.discordMessageId ? delivery.discordMessageId.split(',') : [];
      for (let i = delivery.partsSent; i < messages.length; i++) {
        const { messageId } = await this.sender.send(
          schedule.channelId,
          messages[i]!,
          nonceFor(scheduleId, occurrenceKey, i),
        );
        ids.push(messageId);
        await this.prisma.scheduledDelivery.update({
          where: { id: delivery.id },
          data: { partsSent: i + 1, discordMessageId: ids.join(',') },
        });
      }
      await this.prisma.$transaction([
        this.prisma.scheduledDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', deliveredAt: new Date(), error: null },
        }),
        this.prisma.scheduledMessage.update({
          where: { id: scheduleId },
          data: { lastSuccessAt: new Date(), lastError: null },
        }),
      ]);
      await this.advanceAndEnqueue(schedule, occurrenceKey);
      return 'delivered';
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      if (err instanceof SendError && err.permanent) {
        await this.prisma.$transaction([
          this.prisma.scheduledDelivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED', error: message },
          }),
          this.prisma.scheduledMessage.update({
            where: { id: scheduleId },
            data: { status: 'ERROR', lastError: message, nextRunAt: null, nextOccurrenceKey: null },
          }),
        ]);
        this.opts.logger?.warn(
          { scheduleId, occurrenceKey, err: message },
          'Agendamento suspenso por falha permanente',
        );
        await this.opts.onPermanentFailure?.(schedule, message).catch(() => undefined);
        return 'permanent-failure';
      }
      await this.prisma.scheduledDelivery.update({ where: { id: delivery.id }, data: { error: message } });
      await this.prisma.scheduledMessage.update({ where: { id: scheduleId }, data: { lastError: message } });
      throw err; // transitório: a fila tenta de novo com backoff
    }
  }

  private async claim(scheduleId: string, occurrenceKey: string) {
    try {
      return await this.prisma.scheduledDelivery.create({
        data: {
          scheduledMessageId: scheduleId,
          occurrenceKey,
          status: 'PENDING',
          attempts: 1,
          attemptedAt: new Date(),
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const existing = await this.prisma.scheduledDelivery.findUniqueOrThrow({
        where: { scheduledMessageId_occurrenceKey: { scheduledMessageId: scheduleId, occurrenceKey } },
      });
      if (existing.status !== 'PENDING') return existing;
      return this.prisma.scheduledDelivery.update({
        where: { id: existing.id },
        data: { attempts: { increment: 1 }, attemptedAt: new Date() },
      });
    }
  }

  private async advanceAndEnqueue(schedule: ScheduledMessage, occurrenceKey: string): Promise<void> {
    const next = await this.schedules.advance(schedule.id, occurrenceKey, schedule.nextRunAt ?? new Date());
    if (next)
      await this.jobs.schedule('schedule-delivery', scheduleJobId(schedule.id, next.key), next.runAt, {
        scheduleId: schedule.id,
        occurrenceKey: next.key,
      });
  }
}

export function nonceFor(scheduleId: string, occurrenceKey: string, part = 0): string {
  // O Discord aceita nonce de até 25 caracteres.
  return createHash('sha256').update(`${scheduleId}|${occurrenceKey}|${part}`).digest('hex').slice(0, 25);
}
