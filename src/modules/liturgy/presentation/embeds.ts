import { EmbedBuilder } from 'discord.js';
import { DISCORD_LIMITS, escapeDiscord, splitText, truncate } from '../../../shared/discord-text.js';
import { formatLongDate } from '../../../shared/dates.js';
import {
  LITURGY_ATTRIBUTION,
  LITURGY_SOURCE_URL,
  primaryCelebration,
  type LiturgicalCelebration,
  type LiturgicalDay,
  type Reading,
} from '../domain/types.js';
import type { DayInfo } from '../../calendar/rules/general-roman-calendar.js';

const COLOR_HEX: Record<string, number> = {
  verde: 0x2e7d32,
  vermelho: 0xc62828,
  roxo: 0x6a1b9a,
  rosa: 0xe57399,
  branco: 0xf2efe6,
  preto: 0x212121,
  dourado: 0xc9a227,
};

export const LITURGY_FOOTER = `${LITURGY_ATTRIBUTION} — textos do provedor, não da tradução Matos Soares`;

export function colorFor(color: string | null | undefined): number {
  return COLOR_HEX[(color ?? '').toLowerCase()] ?? 0x8b6f3a;
}

const colorDot = (c: string | null) => {
  const map: Record<string, string> = {
    verde: '🟢',
    vermelho: '🔴',
    roxo: '🟣',
    rosa: '🌸',
    branco: '⚪',
    preto: '⚫',
  };
  return c ? `${map[c.toLowerCase()] ?? '◽'} ${c}` : '—';
};

export function readingReferences(readings: Reading[]): string {
  if (readings.length === 0) return '—';
  return readings
    .map((r) => {
      const refs = r.options
        .map((o) => o.reference ?? o.title ?? '(sem referência)')
        .map((x) => escapeDiscord(x));
      return `**${escapeDiscord(r.label)}:** ${refs.join(' *ou* ')}`;
    })
    .join('\n');
}

export function liturgyDayEmbed(day: LiturgicalDay, calendar?: DayInfo): EmbedBuilder {
  const c = primaryCelebration(day)!;
  const embed = new EmbedBuilder()
    .setColor(colorFor(c.color))
    .setTitle(truncate(c.name, DISCORD_LIMITS.embedTitle))
    .setURL(LITURGY_SOURCE_URL)
    .setDescription(`📅 ${formatLongDate(day.date)}`)
    .addFields(
      { name: 'Cor litúrgica', value: colorDot(c.color), inline: true },
      ...(calendar
        ? [
            {
              name: 'Tempo',
              value: `${calendar.seasonLabel} · Ano ${calendar.sundayCycle} / ${calendar.weekdayCycle}`,
              inline: true,
            },
          ]
        : []),
      { name: 'Leituras', value: truncate(readingReferences(c.readings), DISCORD_LIMITS.embedFieldValue) },
    );
  const others = day.celebrations.filter((x) => x !== c);
  if (others.length > 0) {
    embed.addFields({
      name: 'Outras celebrações possíveis',
      value: truncate(
        others.map((o) => `• ${escapeDiscord(o.name)} (${o.color ?? 'cor não informada'})`).join('\n'),
        1024,
      ),
    });
  }
  embed.setFooter({ text: `${LITURGY_FOOTER} · /liturgia leituras para os textos` });
  return embed;
}

/** Texto completo de UMA leitura (todas as alternativas), paginado. */
export function readingTextEmbeds(
  day: LiturgicalDay,
  celebration: LiturgicalCelebration,
  reading: Reading,
  maxEmbeds = 3,
): EmbedBuilder[] {
  const parts = reading.options.map((o, i) => {
    const head = [
      reading.options.length > 1 ? `__Opção ${i + 1}__` : '',
      o.reference ? `**${escapeDiscord(o.reference)}**` : '',
      o.title ? `*${escapeDiscord(o.title)}*` : '',
      o.refrain ? `**R.** ${escapeDiscord(o.refrain)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return `${head}\n\n${escapeDiscord(o.text)}`;
  });
  const pages = splitText(parts.join('\n\n———\n\n'), DISCORD_LIMITS.embedDescription - 200);
  const shown = pages.slice(0, maxEmbeds);
  return shown.map((page, i) => {
    const e = new EmbedBuilder().setColor(colorFor(celebration.color)).setDescription(page);
    if (i === 0)
      e.setTitle(truncate(`${reading.label} — ${formatLongDate(day.date)}`, DISCORD_LIMITS.embedTitle));
    if (i === shown.length - 1) {
      if (pages.length > maxEmbeds) e.setDescription(`${page}\n\n*(texto truncado por limite do Discord)*`);
      e.setFooter({ text: LITURGY_FOOTER });
    }
    return e;
  });
}

export function prayersEmbed(day: LiturgicalDay, c: LiturgicalCelebration): EmbedBuilder {
  const field = (name: string, value?: string) =>
    value ? [{ name, value: truncate(escapeDiscord(value), DISCORD_LIMITS.embedFieldValue) }] : [];
  const e = new EmbedBuilder()
    .setColor(colorFor(c.color))
    .setTitle(truncate(`Orações — ${c.name}`, DISCORD_LIMITS.embedTitle))
    .setDescription(`📅 ${formatLongDate(day.date)}`)
    .addFields(
      ...field('Antífona de entrada', c.antiphons.entrance),
      ...field('Oração do dia (Coleta)', c.prayers.collect),
      ...field('Sobre as oferendas', c.prayers.offerings),
      ...field('Antífona da comunhão', c.antiphons.communion),
      ...field('Depois da comunhão', c.prayers.communion),
    )
    .setFooter({ text: LITURGY_FOOTER });
  if (c.prayers.extras.length > 0)
    e.addFields({
      name: 'Orações adicionais',
      value: truncate(c.prayers.extras.map((x) => `• ${escapeDiscord(x.title)}`).join('\n'), 1024),
    });
  return e;
}

export function calendarDayEmbed(
  info: DayInfo,
  liturgy?: { name: string; color: string | null } | null,
  liturgyNote?: string,
): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(colorFor(liturgy?.color))
    .setTitle(`Calendário litúrgico — ${formatLongDate(info.date)}`)
    .addFields(
      {
        name: 'Celebração (provedor)',
        value: liturgy
          ? `${escapeDiscord(liturgy.name)}\n${colorDot(liturgy.color)}`
          : (liturgyNote ?? 'Indisponível'),
      },
      {
        name: 'Tempo litúrgico',
        value: `${info.seasonLabel}${info.week ? ` · ${info.week}ª semana` : ''}`,
        inline: true,
      },
      {
        name: 'Ciclos',
        value: `Domingos: Ano ${info.sundayCycle} · Dias de semana: Ano ${info.weekdayCycle}`,
        inline: true,
      },
      { name: 'Dia (cálculo do bot)', value: info.description },
    );
  if (info.observances.length > 0) {
    e.addFields({
      name: 'No Calendário Romano Geral',
      value: info.observances.map((o) => `• ${o.name} (${o.rank})`).join('\n'),
    });
  }
  e.setFooter({
    text: `Tempo/ciclos: cálculo próprio (sem precedência nem calendários nacionais). Celebração: ${LITURGY_ATTRIBUTION}`,
  });
  return e;
}
