import type { ModerationAction, PrismaClient } from '@prisma/client';
import type { Logger } from '../../../shared/logger.js';
import { safeJobId, type JobScheduler } from '../../../jobs/job-scheduler.js';
import {
  chooseMechanism,
  computeExpiry,
  describeDuration,
  parseDuration,
  validateSpan,
} from '../domain/duration.js';
import type { MuteGateway } from './mute-gateway.js';

export type MuteOutcome =
  | { ok: true; action: ModerationAction; superseded: number; durationLabel: string }
  | { ok: false; error: string };

export interface MuteRequest {
  guildId: string;
  targetUserId: string;
  actorUserId: string;
  reason: string;
  durationInput: string;
  timezone: string;
  mutedRoleId: string | null;
  now?: Date;
  /** Chamado após escolher o mecanismo e ANTES de aplicar, para validações dependentes do Discord. */
  precheck?: (mechanism: 'NATIVE_TIMEOUT' | 'MUTED_ROLE') => Promise<string | null>;
}

export function muteJobId(actionId: string): string {
  return safeJobId('mute-release', actionId);
}

/**
 * Silenciamentos duráveis. Regras:
 * - até 28 dias: timeout nativo; acima: cargo de silenciado;
 * - um novo mute SUBSTITUI o ativo anterior (status SUPERSEDED), cujo job de
 *   liberação, se disparar, não faz nada — evita liberar alguém que recebeu mute posterior;
 * - a liberação sempre revalida o estado no PostgreSQL.
 */
export class MuteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: MuteGateway,
    private readonly jobs: JobScheduler,
    private readonly logger?: Logger,
  ) {}

  async mute(req: MuteRequest): Promise<MuteOutcome> {
    const now = req.now ?? new Date();
    const parsed = parseDuration(req.durationInput);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const expiresAt = computeExpiry(parsed.parts, now, req.timezone);
    const spanError = validateSpan(now, expiresAt);
    if (spanError) return { ok: false, error: spanError };
    const mechanism = chooseMechanism(now, expiresAt);
    if (mechanism === 'MUTED_ROLE' && !req.mutedRoleId) {
      return {
        ok: false,
        error:
          'Silenciamentos acima de 28 dias exigem um cargo de silenciado. Configure com `/configurar-silenciado`.',
      };
    }
    const preError = await req.precheck?.(mechanism);
    if (preError) return { ok: false, error: preError };

    const previous = await this.prisma.moderationAction.findMany({
      where: { guildId: req.guildId, targetUserId: req.targetUserId, type: 'MUTE', status: 'ACTIVE' },
    });

    const action = await this.prisma.$transaction(async (tx) => {
      if (previous.length) {
        await tx.moderationAction.updateMany({
          where: { id: { in: previous.map((p) => p.id) } },
          data: { status: 'SUPERSEDED' },
        });
      }
      return tx.moderationAction.create({
        data: {
          guildId: req.guildId,
          type: 'MUTE',
          targetUserId: req.targetUserId,
          actorUserId: req.actorUserId,
          reason: req.reason,
          mechanism,
          status: 'ACTIVE',
          durationInput: req.durationInput,
          startsAt: now,
          expiresAt,
          metadata: {
            timezone: req.timezone,
            mutedRoleId: mechanism === 'MUTED_ROLE' ? req.mutedRoleId : null,
          },
        },
      });
    });

    try {
      if (mechanism === 'NATIVE_TIMEOUT') {
        await this.gateway.applyTimeout(req.guildId, req.targetUserId, expiresAt, req.reason);
      } else {
        const r = await this.gateway.addRole(req.guildId, req.targetUserId, req.mutedRoleId!, req.reason);
        if (r === 'member-missing') throw new Error('Membro não está no servidor');
      }
    } catch (err) {
      // Falhou no Discord: marca a nova ação como FALHA e restaura as anteriores.
      await this.prisma.$transaction([
        this.prisma.moderationAction.update({
          where: { id: action.id },
          data: { status: 'FAILED', releaseReason: (err as Error).message.slice(0, 500) },
        }),
        ...(previous.length
          ? [
              this.prisma.moderationAction.updateMany({
                where: { id: { in: previous.map((p) => p.id) } },
                data: { status: 'ACTIVE' },
              }),
            ]
          : []),
      ]);
      this.logger?.warn(
        { err: (err as Error).message, guildId: req.guildId },
        'Falha ao aplicar silenciamento',
      );
      return { ok: false, error: `O Discord recusou a ação: ${(err as Error).message}` };
    }

    // Desfaz o mecanismo anterior se mudou (ex.: cargo → timeout).
    for (const p of previous) {
      await this.cancelJob(p.id);
      if (p.mechanism !== mechanism)
        await this.undoMechanism(p, 'Substituído por novo silenciamento').catch(() => undefined);
    }
    await this.jobs.schedule('mute-release', muteJobId(action.id), expiresAt, { actionId: action.id });
    return { ok: true, action, superseded: previous.length, durationLabel: describeDuration(parsed.parts) };
  }

  /**
   * Libera um silenciamento. Sem `by`, é a expiração automática (job ou varredura).
   * Retorna o que aconteceu, sem lançar se o estado mudou nesse meio-tempo.
   */
  async release(
    actionId: string,
    opts: { by?: string; reason?: string; now?: Date } = {},
  ): Promise<'released' | 'expired' | 'noop' | 'rescheduled'> {
    const now = opts.now ?? new Date();
    const action = await this.prisma.moderationAction.findUnique({ where: { id: actionId } });
    if (!action || action.type !== 'MUTE' || action.status !== 'ACTIVE') return 'noop';
    const manual = Boolean(opts.by);
    if (!manual && action.expiresAt && action.expiresAt.getTime() > now.getTime() + 2_000) {
      await this.jobs.schedule('mute-release', muteJobId(action.id), action.expiresAt, {
        actionId: action.id,
      });
      return 'rescheduled';
    }

    // Marca primeiro (condicional ao status) para que execuções concorrentes não liberem duas vezes.
    const claimed = await this.prisma.moderationAction.updateMany({
      where: { id: action.id, status: 'ACTIVE' },
      data: {
        status: manual ? 'RELEASED' : 'EXPIRED',
        releasedAt: now,
        releasedById: opts.by ?? null,
        releaseReason: opts.reason ?? (manual ? null : 'expirado'),
      },
    });
    if (claimed.count === 0) return 'noop';

    if (action.mechanism === 'MUTED_ROLE' || manual) {
      await this.undoMechanism(action, opts.reason ?? 'Silenciamento expirado').catch((err) =>
        this.logger?.warn(
          { err: (err as Error).message, actionId },
          'Falha ao desfazer silenciamento no Discord',
        ),
      );
    }
    if (manual) await this.cancelJob(action.id);
    return manual ? 'released' : 'expired';
  }

  async unmute(
    guildId: string,
    targetUserId: string,
    actorUserId: string,
    reason: string,
  ): Promise<ModerationAction | null> {
    const active = await this.activeMute(guildId, targetUserId);
    if (!active) return null;
    const r = await this.release(active.id, { by: actorUserId, reason });
    return r === 'released' ? active : null;
  }

  activeMute(guildId: string, targetUserId: string): Promise<ModerationAction | null> {
    return this.prisma.moderationAction.findFirst({
      where: { guildId, targetUserId, type: 'MUTE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  history(guildId: string, targetUserId: string, take = 5): Promise<ModerationAction[]> {
    return this.prisma.moderationAction.findMany({
      where: { guildId, targetUserId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Reentrada no servidor: reaplica o cargo de um silenciamento ativo (evita fuga do mute). */
  async onMemberRejoin(guildId: string, userId: string, now = new Date()): Promise<boolean> {
    const active = await this.activeMute(guildId, userId);
    if (!active || active.mechanism !== 'MUTED_ROLE') return false;
    if (active.expiresAt && active.expiresAt <= now) {
      await this.release(active.id, { now });
      return false;
    }
    const roleId = (active.metadata as { mutedRoleId?: string } | null)?.mutedRoleId;
    if (!roleId) return false;
    await this.gateway.addRole(guildId, userId, roleId, 'Silenciamento ativo reaplicado ao reentrar');
    return true;
  }

  /** Intervenção manual pelo Discord (timeout removido ou cargo retirado à mão). */
  async onManualRemoval(
    guildId: string,
    userId: string,
    mechanism: 'NATIVE_TIMEOUT' | 'MUTED_ROLE',
    now = new Date(),
  ): Promise<boolean> {
    const active = await this.activeMute(guildId, userId);
    if (!active || active.mechanism !== mechanism) return false;
    if (active.expiresAt && active.expiresAt.getTime() <= now.getTime() + 5_000) return false;
    await this.prisma.moderationAction.updateMany({
      where: { id: active.id, status: 'ACTIVE' },
      data: { status: 'RELEASED', releasedAt: now, releaseReason: 'removido manualmente no Discord' },
    });
    await this.cancelJob(active.id);
    return true;
  }

  /** Após reinício: libera os vencidos e garante job para os ativos. */
  async reconcile(now = new Date()): Promise<{ expired: number; rescheduled: number }> {
    const active = await this.prisma.moderationAction.findMany({ where: { type: 'MUTE', status: 'ACTIVE' } });
    let expired = 0;
    let rescheduled = 0;
    for (const a of active) {
      if (!a.expiresAt) continue;
      if (a.expiresAt <= now) {
        if ((await this.release(a.id, { now })) === 'expired') expired++;
      } else {
        await this.jobs.schedule('mute-release', muteJobId(a.id), a.expiresAt, { actionId: a.id });
        rescheduled++;
      }
    }
    return { expired, rescheduled };
  }

  private async undoMechanism(action: ModerationAction, reason: string): Promise<void> {
    if (action.mechanism === 'NATIVE_TIMEOUT') {
      await this.gateway.clearTimeout(action.guildId, action.targetUserId, reason);
    } else if (action.mechanism === 'MUTED_ROLE') {
      const roleId = (action.metadata as { mutedRoleId?: string } | null)?.mutedRoleId;
      if (roleId) await this.gateway.removeRole(action.guildId, action.targetUserId, roleId, reason);
    }
  }

  private cancelJob(actionId: string): Promise<void> {
    return this.jobs.cancel(muteJobId(actionId));
  }
}
