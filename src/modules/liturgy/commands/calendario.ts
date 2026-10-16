import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { SlashCommand } from '../../../bot/types.js';
import { formatLongDate, localDate, parseBrDate } from '../../../shared/dates.js';
import { saintsEmbed } from '../presentation/daily-post.js';
import type { LitcalCalendarId, LitcalLocale } from '../../calendar/providers/litcal/client.js';
import { truncate } from '../../../shared/discord-text.js';
import { calendarProviderFor } from '../../calendar/providers/calendar-provider.js';
import { describeLiturgyFailure, type LiturgyResult } from '../application/liturgy-service.js';
import { calendarDayEmbed, colorFor, LITURGY_FOOTER } from '../presentation/embeds.js';
import { primaryCelebration, type LiturgyLocale } from '../domain/types.js';

const data = new SlashCommandBuilder()
  .setName('calendario')
  .setDescription('Calendário litúrgico')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('hoje').setDescription('Hoje no calendário litúrgico'))
  .addSubcommand((s) => s.setName('amanha').setDescription('Amanhã no calendário litúrgico'))
  .addSubcommand((s) =>
    s
      .setName('data')
      .setDescription('Uma data específica')
      .addStringOption((o) =>
        o.setName('dia').setDescription('DD/MM/AAAA').setRequired(true).setMaxLength(10),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('semana')
      .setDescription('Sete dias a partir de uma data')
      .addStringOption((o) =>
        o.setName('inicio').setDescription('DD/MM/AAAA (padrão: hoje)').setMaxLength(10),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('mes')
      .setDescription('Resumo de um mês')
      .addStringOption((o) => o.setName('mes').setDescription('MM/AAAA (padrão: mês atual)').setMaxLength(7)),
  )
  .addSubcommand((s) =>
    s
      .setName('santos')
      .setDescription('Santos e celebrações do dia no Calendário Romano (LitCal)')
      .addStringOption((o) =>
        o.setName('dia').setDescription('DD/MM/AAAA (padrão: hoje no fuso do servidor)').setMaxLength(10),
      ),
  )
  .toJSON();

const WEEKDAY = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function summaryLine(iso: string, r: LiturgyResult): string {
  const d = DateTime.fromISO(iso);
  const label = `\`${d.toFormat('dd/MM')} ${WEEKDAY[d.weekday - 1]}\``;
  if (r.status !== 'ok') return `${label} — ${r.status === 'not-found' ? 'não encontrada' : 'indisponível'}`;
  const c = primaryCelebration(r.day)!;
  return `${label} — ${c.name}${c.color ? ` (${c.color})` : ''}`;
}

export const calendarioCommand: SlashCommand = {
  data,
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const settings = await ctx.settings.get(interaction.guildId);
    const calendar = calendarProviderFor(settings.calendarVariant);
    const version = ctx.liturgy.resolveVersion(settings.liturgyApiVersion);
    const locale = settings.locale as LiturgyLocale;

    if (sub === 'santos') {
      if (!ctx.saints) {
        await interaction.reply({
          content: 'Os santos do dia estão desativados neste bot (LITCAL_ENABLED=false).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const raw = interaction.options.getString('dia');
      const iso = raw ? parseBrDate(raw) : localDate(settings.timezone);
      if (!iso) {
        await interaction.reply({ content: 'Data inválida. Use DD/MM/AAAA.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      const r = await ctx.saints.getDay(
        iso,
        settings.romanCalendarId as LitcalCalendarId,
        settings.romanCalendarLocale as LitcalLocale,
      );
      const embed = saintsEmbed(r);
      embed.title = `${embed.title} — ${formatLongDate(iso)}`;
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'hoje' || sub === 'amanha' || sub === 'data') {
      const iso =
        sub === 'data'
          ? parseBrDate(interaction.options.getString('dia', true))
          : localDate(settings.timezone, sub === 'amanha' ? 1 : 0);
      if (!iso) {
        await interaction.reply({ content: 'Data inválida. Use DD/MM/AAAA.', flags: MessageFlags.Ephemeral });
        return;
      }
      const cal = calendar.describe(iso);
      if (!cal.supported) {
        await interaction.reply({ content: cal.reason, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      const r = await ctx.liturgy.getDay(iso, version, locale);
      const c = r.status === 'ok' ? primaryCelebration(r.day) : undefined;
      await interaction.editReply({
        embeds: [
          calendarDayEmbed(
            cal.day,
            c ? { name: c.name, color: c.color } : null,
            r.status === 'ok' ? undefined : describeLiturgyFailure(r),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    let start: string | null;
    let days: number;
    let title: string;
    if (sub === 'semana') {
      const raw = interaction.options.getString('inicio');
      start = raw ? parseBrDate(raw) : localDate(settings.timezone);
      days = 7;
      title = 'Semana litúrgica';
    } else {
      const raw = interaction.options.getString('mes');
      const now = DateTime.fromISO(localDate(settings.timezone));
      const m = raw ? /^(\d{1,2})\/(\d{4})$/.exec(raw.trim()) : null;
      const month = m
        ? DateTime.fromObject({ year: Number(m[2]), month: Number(m[1]), day: 1 })
        : now.startOf('month');
      start = raw && (!m || !month.isValid) ? null : month.toISODate();
      days = month.isValid ? month.daysInMonth! : 0;
      title = month.isValid ? `Calendário — ${month.setLocale('pt-BR').toFormat('LLLL yyyy')}` : '';
    }
    if (!start) {
      await interaction.reply({
        content: 'Data inválida. Use DD/MM/AAAA (semana) ou MM/AAAA (mês).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    // Datas explícitas, concorrência baixa e cache: evita sobrecarregar o provedor.
    const results = await ctx.liturgy.getRange(start, days, version, locale, sub === 'mes' ? 3 : 2);
    const lines = results.map((r, i) =>
      summaryLine(DateTime.fromISO(start).plus({ days: i }).toISODate()!, r),
    );
    const failures = results.filter((r) => r.status === 'error').length;
    const firstOk = results.find((r) => r.status === 'ok');
    const embed = new EmbedBuilder()
      .setColor(colorFor(firstOk?.status === 'ok' ? primaryCelebration(firstOk.day)?.color : null))
      .setTitle(title)
      .setDescription(truncate(lines.join('\n'), 4096))
      .setFooter({
        text: `${failures ? `${failures} dia(s) indisponível(is) no provedor · ` : ''}${LITURGY_FOOTER}`,
      });
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
