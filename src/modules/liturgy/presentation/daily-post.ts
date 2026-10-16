import type { APIEmbed } from 'discord.js';
import { escapeDiscord, truncate } from '../../../shared/discord-text.js';
import { formatLongDate } from '../../../shared/dates.js';
import { packEmbedJson } from '../../../shared/embed-pack.js';
import { describeDay } from '../../calendar/rules/general-roman-calendar.js';
import type { SaintsResult } from '../../calendar/application/saints-service.js';
import { describeLiturgyFailure, type LiturgyResult } from '../application/liturgy-service.js';
import { primaryCelebration } from '../domain/types.js';
import { PRE_1970_MESSAGE } from '../../calendar/rules/pre-1970.js';
import { liturgyDayEmbed, readingTextEmbeds } from './embeds.js';
import type { OutgoingMessage } from '../../scheduling/application/types.js';

export type ReadingsMode = 'none' | 'references' | 'gospel' | 'full';

export const LITCAL_LOCALE_LABEL: Record<string, string> = {
  la: 'latim',
  en: 'inglês',
  it: 'italiano',
  fr: 'francês',
  nl: 'neerlandês',
};
export const LITCAL_CALENDAR_LABEL: Record<string, string> = {
  GENERAL: 'Calendário Romano Geral',
  CA: 'Canadá',
  HR: 'Croácia',
  IT: 'Itália',
  NL: 'Países Baixos',
  US: 'Estados Unidos',
};

/** Máximo de mensagens num único anúncio (evita inundar o canal). */
export const MAX_DAILY_MESSAGES = 6;

export function saintsEmbed(result: SaintsResult): APIEmbed {
  if (result.status !== 'ok') {
    return {
      title: 'Santos do dia',
      description:
        result.reason === 'before-1970'
          ? PRE_1970_MESSAGE
          : 'O Calendário Romano (LitCal) está indisponível no momento; nenhum santo foi listado para evitar informação incorreta.',
      color: 0x8b6f3a,
    };
  }
  const lines = result.celebrations.map((c) => {
    const colors = c.colors.length ? ` · ${c.colors.map(escapeDiscord).join(', ')}` : '';
    return `• **${escapeDiscord(c.name)}** — ${escapeDiscord(c.gradeLabel)}${colors}${c.holyDayOfObligation ? ' · ⛪ preceito' : ''}`;
  });
  return {
    title: `Santos e celebrações — ${LITCAL_CALENDAR_LABEL[result.calendar] ?? result.calendar}`,
    description: truncate(
      lines.length ? lines.join('\n') : 'Féria: nenhuma memória, festa ou solenidade neste calendário.',
      4000,
    ),
    color: 0x8b6f3a,
    footer: {
      text: `Liturgical Calendar API (LitCal) · nomes em ${LITCAL_LOCALE_LABEL[result.locale] ?? result.locale}. Calendários nacionais (ex.: Brasil, Portugal) podem diferir.`,
    },
  };
}

/**
 * Compõe o anúncio diário: cabeçalho com a data real, resumo da liturgia,
 * santos do dia e, conforme a configuração, o Evangelho ou todas as leituras.
 */
export function composeDailyPost(params: {
  date: string;
  heading: string;
  liturgy: LiturgyResult | null;
  saints: SaintsResult | null;
  readings: ReadingsMode;
}): OutgoingMessage[] {
  const { date, liturgy, saints, readings } = params;
  const embeds: APIEmbed[] = [];
  const day = liturgy?.status === 'ok' ? liturgy.day : null;
  const celebration = day ? primaryCelebration(day) : undefined;

  if (liturgy) {
    if (day) {
      if (readings !== 'none') embeds.push(liturgyDayEmbed(day, describeDay(date)).toJSON());
    } else {
      embeds.push({
        title: 'Liturgia do dia',
        description: describeLiturgyFailure(liturgy as Exclude<LiturgyResult, { status: 'ok' }>),
        color: 0x8b6f3a,
      });
    }
  }
  if (saints) embeds.push(saintsEmbed(saints));

  const textEmbeds: APIEmbed[] = [];
  if (day && celebration && (readings === 'gospel' || readings === 'full')) {
    const selected =
      readings === 'gospel'
        ? celebration.readings.filter((r) => r.type === 'evangelho')
        : celebration.readings;
    for (const r of selected)
      textEmbeds.push(...readingTextEmbeds(day, celebration, r, 3).map((e) => e.toJSON()));
  }

  const content = truncate(`${params.heading} — ${formatLongDate(date)}`, 2000);
  const head = packEmbedJson(embeds).map((group, i) => ({
    ...(i === 0 ? { content } : {}),
    embeds: group,
    allowedRoleIds: [],
  }));
  if (head.length === 0) head.push({ content, embeds: [], allowedRoleIds: [] });
  const body = packEmbedJson(textEmbeds).map((group) => ({ embeds: group, allowedRoleIds: [] }));
  const all: OutgoingMessage[] = [...head, ...body];
  if (all.length > MAX_DAILY_MESSAGES) {
    const kept = all.slice(0, MAX_DAILY_MESSAGES);
    kept.push({
      content: '*(leituras restantes omitidas para não inundar o canal — use `/liturgia leituras`)*',
      allowedRoleIds: [],
    });
    return kept;
  }
  return all;
}
