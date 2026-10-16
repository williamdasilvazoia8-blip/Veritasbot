import type { ScheduledMessage } from '@prisma/client';
import type { GuildSettingsService } from '../../guild-settings/settings-service.js';
import type { LiturgyService } from '../../liturgy/application/liturgy-service.js';
import type { SaintsService } from '../../calendar/application/saints-service.js';
import type { LitcalCalendarId, LitcalLocale } from '../../calendar/providers/litcal/client.js';
import type { LiturgyLocale } from '../../liturgy/domain/types.js';
import { composeDailyPost } from '../../liturgy/presentation/daily-post.js';
import { addDays } from '../../../shared/dates.js';
import type { MessageRenderer } from './delivery-service.js';
import { liturgyPayloadSchema, textPayloadSchema, type OutgoingMessage } from './types.js';

/** Tentativas antes de publicar um aviso honesto de indisponibilidade dos provedores. */
const ATTEMPTS_BEFORE_NOTICE = 3;

export class ScheduledMessageRenderer implements MessageRenderer {
  constructor(
    private readonly settings: GuildSettingsService,
    private readonly liturgy: LiturgyService,
    private readonly saints: SaintsService | null,
  ) {}

  async render(
    schedule: ScheduledMessage,
    occurrenceKey: string,
    attempt: number,
  ): Promise<OutgoingMessage[]> {
    if (schedule.kind === 'TEXT') {
      const p = textPayloadSchema.parse(schedule.payload);
      const mentions = p.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
      if (p.title) {
        return [
          {
            ...(mentions ? { content: mentions } : {}),
            embeds: [{ title: p.title, description: p.content, color: 0x8b6f3a }],
            allowedRoleIds: p.mentionRoleIds,
          },
        ];
      }
      return [
        { content: mentions ? `${mentions}\n${p.content}` : p.content, allowedRoleIds: p.mentionRoleIds },
      ];
    }

    // Modelo dinâmico: tudo é buscado NO MOMENTO da ocorrência, para a data civil
    // local da ocorrência (fuso do agendamento) — a data real, não a do servidor nem a da API.
    const p = liturgyPayloadSchema.parse(schedule.payload);
    const date = addDays(occurrenceKey.slice(0, 10), p.offsetDays);
    const s = await this.settings.get(schedule.guildId);

    const liturgy =
      p.readings === 'none'
        ? null
        : await this.liturgy.getDay(
            date,
            this.liturgy.resolveVersion(s.liturgyApiVersion),
            s.locale as LiturgyLocale,
          );
    const saints =
      p.saints && this.saints
        ? await this.saints.getDay(
            date,
            s.romanCalendarId as LitcalCalendarId,
            s.romanCalendarLocale as LitcalLocale,
            { includeOptional: p.optionalMemorials },
          )
        : null;

    const failed = liturgy?.status === 'error' || saints?.status === 'error';
    if (failed && attempt < ATTEMPTS_BEFORE_NOTICE) {
      throw new Error('Provedor litúrgico indisponível; nova tentativa agendada');
    }
    const heading = p.offsetDays === 1 ? '📖 Liturgia de amanhã' : '📖 Liturgia de hoje';
    return composeDailyPost({ date, heading, liturgy, saints, readings: p.readings });
  }
}
