import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import type { SlashCommand } from '../../../bot/types.js';
import type { AppContext } from '../../../app/context.js';
import { requireMemberPermission } from '../../../bot/guards.js';
import { localDate, parseBrDate } from '../../../shared/dates.js';
import { describeLiturgyFailure } from '../application/liturgy-service.js';
import { liturgyDayEmbed, prayersEmbed, readingTextEmbeds } from '../presentation/embeds.js';
import { primaryCelebration, type LiturgyLocale } from '../domain/types.js';
import { describeDay } from '../../calendar/rules/general-roman-calendar.js';
import { LITCAL_CALENDARS, LITCAL_LOCALES } from '../../calendar/providers/litcal/client.js';
import { LITCAL_CALENDAR_LABEL, LITCAL_LOCALE_LABEL } from '../presentation/daily-post.js';

const dateOpt = (required: boolean) => (o: SlashCommandStringOption) =>
  o
    .setName('dia')
    .setDescription('Data no formato DD/MM/AAAA (padrão: hoje no fuso do servidor)')
    .setRequired(required)
    .setMaxLength(10);

const data = new SlashCommandBuilder()
  .setName('liturgia')
  .setDescription('Liturgia diária da Missa (fonte: Liturgia Diária / Dancrf)')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('hoje').setDescription('Liturgia de hoje'))
  .addSubcommand((s) => s.setName('amanha').setDescription('Liturgia de amanhã'))
  .addSubcommand((s) =>
    s.setName('data').setDescription('Liturgia de uma data').addStringOption(dateOpt(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('leituras')
      .setDescription('Referências das leituras ou o texto de uma delas')
      .addStringOption(dateOpt(false))
      .addIntegerOption((o) =>
        o
          .setName('numero')
          .setDescription('Número da leitura na sequência (1 = primeira) para ver o texto')
          .setMinValue(1)
          .setMaxValue(20),
      ),
  )
  .addSubcommand((s) =>
    s.setName('evangelho').setDescription('Texto do Evangelho do dia').addStringOption(dateOpt(false)),
  )
  .addSubcommand((s) =>
    s.setName('oracoes').setDescription('Orações e antífonas da Missa').addStringOption(dateOpt(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('configuracao')
      .setDescription('(Admin) Configura a liturgia neste servidor')
      .addBooleanOption((o) => o.setName('ativada').setDescription('Habilitar comandos de liturgia'))
      .addStringOption((o) =>
        o
          .setName('versao_api')
          .setDescription('Versão da API Liturgia Diária')
          .addChoices({ name: 'v2 (estável)', value: 'v2' }, { name: 'v3 (beta)', value: 'v3' }),
      )
      .addStringOption((o) =>
        o
          .setName('calendario_romano')
          .setDescription('Calendário usado para os santos do dia (LitCal)')
          .addChoices(...LITCAL_CALENDARS.map((c) => ({ name: LITCAL_CALENDAR_LABEL[c] ?? c, value: c }))),
      )
      .addStringOption((o) =>
        o
          .setName('idioma_calendario')
          .setDescription('Idioma dos nomes dos santos (o LitCal ainda não oferece português)')
          .addChoices(...LITCAL_LOCALES.map((l) => ({ name: LITCAL_LOCALE_LABEL[l] ?? l, value: l }))),
      ),
  )
  .toJSON();

export const liturgiaCommand: SlashCommand = {
  data,
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'configuracao') return configuracao(interaction, ctx);

    const settings = await ctx.settings.get(interaction.guildId);
    if (!settings.liturgyEnabled) {
      await interaction.reply({
        content: 'Os comandos de liturgia estão desativados neste servidor.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    let isoDate: string | null;
    if (sub === 'hoje') isoDate = localDate(settings.timezone);
    else if (sub === 'amanha') isoDate = localDate(settings.timezone, 1);
    else {
      const raw = interaction.options.getString('dia');
      isoDate = raw ? parseBrDate(raw) : localDate(settings.timezone);
    }
    if (!isoDate) {
      await interaction.reply({
        content: 'Data inválida. Use o formato DD/MM/AAAA (ex.: 08/12/2026).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const version = ctx.liturgy.resolveVersion(settings.liturgyApiVersion);
    const result = await ctx.liturgy.getDay(isoDate, version, settings.locale as LiturgyLocale);
    if (result.status !== 'ok') {
      await interaction.editReply({ content: describeLiturgyFailure(result) });
      return;
    }
    const day = result.day;
    const celebration = primaryCelebration(day)!;
    const allowedMentions = { parse: [] };

    if (sub === 'hoje' || sub === 'amanha' || sub === 'data') {
      await interaction.editReply({ embeds: [liturgyDayEmbed(day, describeDay(isoDate))], allowedMentions });
      return;
    }
    if (sub === 'leituras') {
      const n = interaction.options.getInteger('numero');
      if (n === null) {
        await interaction.editReply({
          embeds: [liturgyDayEmbed(day, describeDay(isoDate))],
          allowedMentions,
        });
        return;
      }
      const reading = celebration.readings[n - 1];
      if (!reading) {
        await interaction.editReply({
          content: `Este dia tem ${celebration.readings.length} leitura(s) no provedor.`,
        });
        return;
      }
      await interaction.editReply({ embeds: readingTextEmbeds(day, celebration, reading), allowedMentions });
      return;
    }
    if (sub === 'evangelho') {
      const gospel = celebration.readings.find((r) => r.type === 'evangelho');
      if (!gospel) {
        await interaction.editReply({ content: 'O provedor não informou Evangelho para esta data.' });
        return;
      }
      await interaction.editReply({ embeds: readingTextEmbeds(day, celebration, gospel), allowedMentions });
      return;
    }
    if (sub === 'oracoes') {
      await interaction.editReply({ embeds: [prayersEmbed(day, celebration)], allowedMentions });
    }
  },
};

async function configuracao(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
    return;
  const patch: Record<string, unknown> = {};
  const enabled = interaction.options.getBoolean('ativada');
  if (enabled !== null) patch.liturgyEnabled = enabled;
  const version = interaction.options.getString('versao_api');
  if (version === 'v3' && !ctx.env.LITURGIA_V3_ENABLED) {
    await interaction.reply({
      content: 'A API v3 está em beta e desativada globalmente (LITURGIA_V3_ENABLED=false).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (version) patch.liturgyApiVersion = version;
  const romanCalendar = interaction.options.getString('calendario_romano');
  if (romanCalendar) patch.romanCalendarId = romanCalendar;
  const romanLocale = interaction.options.getString('idioma_calendario');
  if (romanLocale) patch.romanCalendarLocale = romanLocale;
  const s = Object.keys(patch).length
    ? await ctx.settings.update(interaction.guildId, interaction.user.id, patch)
    : await ctx.settings.get(interaction.guildId);
  await interaction.reply({
    content: [
      `**Liturgia:** ${s.liturgyEnabled ? 'ativada' : 'desativada'}`,
      `**Versão da API:** ${ctx.liturgy.resolveVersion(s.liturgyApiVersion)}${s.liturgyApiVersion !== ctx.liturgy.resolveVersion(s.liturgyApiVersion) ? ` (pedida: ${s.liturgyApiVersion})` : ''}`,
      `**Fuso horário:** ${s.timezone} (altere com \`/config fuso\`)`,
      `**Santos do dia:** ${LITCAL_CALENDAR_LABEL[s.romanCalendarId] ?? s.romanCalendarId} · nomes em ${LITCAL_LOCALE_LABEL[s.romanCalendarLocale] ?? s.romanCalendarLocale}${ctx.saints ? '' : ' (desativado globalmente)'}`,
      'Anúncio diário (leituras e santos): use `/agendar liturgia`.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}
