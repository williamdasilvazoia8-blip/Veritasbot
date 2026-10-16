import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type APIEmbed,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type SlashCommandStringOption,
} from 'discord.js';
import { IANAZone } from 'luxon';
import type { ScheduledMessage } from '@prisma/client';
import type { ButtonHandler, SlashCommand } from '../../../bot/types.js';
import type { AppContext } from '../../../app/context.js';
import { requireMemberPermission } from '../../../bot/guards.js';
import { localDate, parseBrDate } from '../../../shared/dates.js';
import { escapeDiscord, truncate } from '../../../shared/discord-text.js';
import { RECURRENCE_LABEL, type RecurrenceKind } from '../domain/recurrence.js';
import { liturgyPayloadSchema, textPayloadSchema, type OutgoingMessage } from '../application/types.js';

const RECURRENCE_CHOICES = [
  { name: 'Uma vez', value: 'ONCE' },
  { name: 'Diária', value: 'DAILY' },
  { name: 'Semanal', value: 'WEEKLY' },
  { name: 'Mensal', value: 'MONTHLY' },
  { name: 'Anual', value: 'YEARLY' },
];

const idOpt = (o: SlashCommandStringOption) =>
  o.setName('id').setDescription('Agendamento').setRequired(true).setAutocomplete(true);
const channelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const data = new SlashCommandBuilder()
  .setName('agendar')
  .setDescription('(Admin) Mensagens agendadas e recorrentes')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('criar')
      .setDescription('Agenda uma mensagem em um canal')
      .addChannelOption((o) =>
        o
          .setName('canal')
          .setDescription('Canal de destino')
          .setRequired(true)
          .addChannelTypes(...channelTypes),
      )
      .addStringOption((o) =>
        o
          .setName('mensagem')
          .setDescription('Texto (use \\n para quebrar linha)')
          .setRequired(true)
          .setMaxLength(2000),
      )
      .addStringOption((o) =>
        o
          .setName('data')
          .setDescription('DD/MM/AAAA (primeira ocorrência)')
          .setRequired(true)
          .setMaxLength(10),
      )
      .addStringOption((o) =>
        o.setName('hora').setDescription('HH:MM (24h)').setRequired(true).setMaxLength(5),
      )
      .addStringOption((o) =>
        o
          .setName('recorrencia')
          .setDescription('Padrão: uma vez')
          .addChoices(...RECURRENCE_CHOICES),
      )
      .addStringOption((o) =>
        o
          .setName('fuso')
          .setDescription('Fuso IANA (padrão: do servidor), ex.: Europe/Lisbon')
          .setMaxLength(64),
      )
      .addStringOption((o) =>
        o.setName('titulo').setDescription('Título (envia como embed)').setMaxLength(256),
      )
      .addRoleOption((o) =>
        o.setName('mencionar_cargo').setDescription('Cargo a mencionar (@everyone nunca é mencionado)'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('liturgia')
      .setDescription('Anúncio diário: leituras e santos do dia, buscados na data real do envio')
      .addChannelOption((o) =>
        o
          .setName('canal')
          .setDescription('Canal de destino')
          .setRequired(true)
          .addChannelTypes(...channelTypes),
      )
      .addStringOption((o) =>
        o.setName('hora').setDescription('HH:MM (24h)').setRequired(true).setMaxLength(5),
      )
      .addBooleanOption((o) =>
        o.setName('vespera').setDescription('Anunciar a liturgia do dia SEGUINTE (ex.: à noite)'),
      )
      .addStringOption((o) =>
        o
          .setName('leituras')
          .setDescription('Quanto das leituras publicar (padrão: todas as leituras)')
          .addChoices(
            { name: 'Todas as leituras (texto completo)', value: 'full' },
            { name: 'Só o Evangelho (texto completo)', value: 'gospel' },
            { name: 'Só o resumo com as referências', value: 'references' },
            { name: 'Nenhuma (só santos)', value: 'none' },
          ),
      )
      .addBooleanOption((o) =>
        o.setName('santos').setDescription('Incluir santos/celebrações do Calendário Romano (padrão: sim)'),
      )
      .addBooleanOption((o) =>
        o.setName('memorias_facultativas').setDescription('Incluir memórias facultativas (padrão: sim)'),
      )
      .addStringOption((o) =>
        o.setName('fuso').setDescription('Fuso IANA (padrão: do servidor)').setMaxLength(64),
      ),
  )
  .addSubcommand((s) => s.setName('listar').setDescription('Lista os agendamentos'))
  .addSubcommand((s) => s.setName('ver').setDescription('Detalhes e últimas entregas').addStringOption(idOpt))
  .addSubcommand((s) =>
    s
      .setName('editar')
      .setDescription('Altera um agendamento')
      .addStringOption(idOpt)
      .addStringOption((o) => o.setName('mensagem').setDescription('Novo texto').setMaxLength(2000))
      .addStringOption((o) => o.setName('data').setDescription('Nova data DD/MM/AAAA').setMaxLength(10))
      .addStringOption((o) => o.setName('hora').setDescription('Nova hora HH:MM').setMaxLength(5))
      .addStringOption((o) =>
        o
          .setName('recorrencia')
          .setDescription('Nova recorrência')
          .addChoices(...RECURRENCE_CHOICES),
      )
      .addChannelOption((o) =>
        o
          .setName('canal')
          .setDescription('Novo canal')
          .addChannelTypes(...channelTypes),
      )
      .addStringOption((o) => o.setName('fuso').setDescription('Novo fuso IANA').setMaxLength(64))
      .addStringOption((o) =>
        o
          .setName('leituras')
          .setDescription('(Liturgia) Quanto das leituras publicar')
          .addChoices(
            { name: 'Todas as leituras (texto completo)', value: 'full' },
            { name: 'Só o Evangelho (texto completo)', value: 'gospel' },
            { name: 'Só o resumo com as referências', value: 'references' },
            { name: 'Nenhuma (só santos)', value: 'none' },
          ),
      )
      .addBooleanOption((o) => o.setName('santos').setDescription('(Liturgia) Incluir santos do dia'))
      .addBooleanOption((o) =>
        o.setName('memorias_facultativas').setDescription('(Liturgia) Incluir memórias facultativas'),
      ),
  )
  .addSubcommand((s) =>
    s.setName('cancelar').setDescription('Cancela definitivamente').addStringOption(idOpt),
  )
  .addSubcommand((s) => s.setName('pausar').setDescription('Pausa').addStringOption(idOpt))
  .addSubcommand((s) =>
    s.setName('retomar').setDescription('Retoma um agendamento pausado ou com erro').addStringOption(idOpt),
  )
  .toJSON();

function parseTime(input: string): string | null {
  const m = /^\s*(\d{1,2})[:h](\d{2})\s*$/.exec(input);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function checkChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  channel: GuildBasedChannel,
): string | null {
  const me = interaction.guild.members.me!;
  if (
    !channel
      .permissionsFor(me)
      .has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
  ) {
    return `O bot não pode enviar mensagens/embeds em <#${channel.id}>.`;
  }
  return null;
}

function summary(s: ScheduledMessage): string {
  const status: Record<string, string> = {
    DRAFT: '📝 rascunho',
    ACTIVE: '✅ ativo',
    PAUSED: '⏸️ pausado',
    ERROR: '⚠️ erro',
    CANCELED: '✖️ cancelado',
    COMPLETED: '✔️ concluído',
  };
  const kind =
    s.kind === 'LITURGY_DAILY'
      ? describeLiturgyPayload(s.payload)
      : truncate(escapeDiscord(textPayloadSchema.safeParse(s.payload).data?.content ?? ''), 60);
  const next = s.nextRunAt ? time(s.nextRunAt, TimestampStyles.ShortDateTime) : '—';
  return `\`${s.id.slice(-8)}\` ${status[s.status]} · <#${s.channelId}> · ${RECURRENCE_LABEL[s.recurrence as RecurrenceKind]} · próxima: ${next}\n↳ ${kind}`;
}

async function previewAndConfirm(
  interaction: ChatInputCommandInteraction<'cached'>,
  ctx: AppContext,
  s: ScheduledMessage,
  nextRunAt: Date,
) {
  const parts: OutgoingMessage[] = await ctx.renderer
    .render(s, s.startLocal, 99)
    .catch((err: Error) => [
      { content: `(pré-visualização indisponível: ${err.message})`, allowedRoleIds: [] },
    ]);
  const render = parts[0] ?? { allowedRoleIds: [] };
  const more =
    parts.length > 1 ? `\n\n*(+${parts.length - 1} mensagem(ns) com as leituras no envio real)*` : '';
  const info = new EmbedBuilder()
    .setTitle('Pré-visualização do agendamento')
    .setColor(0x8b6f3a)
    .setDescription(
      [
        `**Canal:** <#${s.channelId}>`,
        `**Recorrência:** ${RECURRENCE_LABEL[s.recurrence as RecurrenceKind]}`,
        `**Referência local:** ${s.startLocal.replace('T', ' ')} (${s.timezone})`,
        `**Primeiro envio:** ${time(nextRunAt, TimestampStyles.LongDateTime)} (${time(nextRunAt, TimestampStyles.RelativeTime)})`,
        '',
        'Confira abaixo como a mensagem ficará e clique em **Ativar**.',
      ].join('\n') + more,
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sched:activate:${s.id}`)
      .setLabel('Ativar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`sched:discard:${s.id}`)
      .setLabel('Descartar')
      .setStyle(ButtonStyle.Secondary),
  );
  const embeds = [info.toJSON(), ...((render.embeds ?? []) as APIEmbed[])].slice(0, 10);
  await interaction.editReply({
    content: render.content ? truncate(render.content, 2000) : '',
    embeds,
    components: [row],
    allowedMentions: { parse: [] },
  });
}

export const agendarCommand: SlashCommand = {
  data,
  async execute(interaction, ctx) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
      return;
    const sub = interaction.options.getSubcommand();
    const o = interaction.options;
    const settings = await ctx.settings.get(interaction.guildId);
    const reply = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    const tz = o.getString('fuso') ?? settings.timezone;
    if (!IANAZone.isValidZone(tz))
      return void (await reply(
        `Fuso horário inválido: \`${escapeDiscord(tz)}\`. Exemplos: America/Sao_Paulo, Europe/Lisbon.`,
      ));

    if (sub === 'criar' || sub === 'liturgia') {
      const channel = o.getChannel('canal', true, [...channelTypes]);
      const chErr = checkChannel(interaction, channel);
      if (chErr) return void (await reply(chErr));
      const hhmm = parseTime(o.getString('hora', true));
      if (!hhmm) return void (await reply('Hora inválida. Use HH:MM (ex.: 07:00).'));

      let input;
      if (sub === 'criar') {
        const date = parseBrDate(o.getString('data', true));
        if (!date) return void (await reply('Data inválida. Use DD/MM/AAAA.'));
        const role = o.getRole('mencionar_cargo');
        if (role && role.id === interaction.guildId)
          return void (await reply('@everyone não pode ser mencionado por agendamentos.'));
        const payload = textPayloadSchema.parse({
          content: o.getString('mensagem', true).replace(/\\n/g, '\n'),
          ...(o.getString('titulo') ? { title: o.getString('titulo')! } : {}),
          mentionRoleIds: role ? [role.id] : [],
        });
        input = {
          kind: 'TEXT' as const,
          payload,
          startLocal: `${date}T${hhmm}`,
          recurrence: (o.getString('recorrencia') ?? 'ONCE') as RecurrenceKind,
        };
      } else {
        const payload = liturgyPayloadSchema.parse({
          offsetDays: o.getBoolean('vespera') ? 1 : 0,
          readings: o.getString('leituras') ?? 'full',
          saints: o.getBoolean('santos') ?? true,
          optionalMemorials: o.getBoolean('memorias_facultativas') ?? true,
        });
        if (payload.readings === 'none' && !payload.saints) {
          return void (await reply('Escolha ao menos leituras ou santos para o anúncio.'));
        }
        if (payload.saints && !ctx.saints) {
          return void (await reply('Os santos do dia estão desativados neste bot (LITCAL_ENABLED=false).'));
        }
        input = {
          kind: 'LITURGY_DAILY' as const,
          payload,
          startLocal: `${localDate(tz)}T${hhmm}`,
          recurrence: 'DAILY' as const,
        };
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await ctx.schedules.createDraft({
        guildId: interaction.guildId,
        channelId: channel.id,
        creatorId: interaction.user.id,
        timezone: tz,
        ...input,
      });
      if (!res.ok) return void (await interaction.editReply(res.error));
      await previewAndConfirm(interaction, ctx, res.schedule, res.next!.runAt);
      return;
    }

    if (sub === 'listar') {
      const list = await ctx.schedules.list(interaction.guildId);
      if (!list.length) return void (await reply('Nenhum agendamento.'));
      const embed = new EmbedBuilder()
        .setTitle('Agendamentos')
        .setColor(0x8b6f3a)
        .setDescription(truncate(list.map(summary).join('\n\n'), 4096));
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const id = await resolveId(ctx, interaction.guildId, o.getString('id', true));
    if (!id) return void (await reply('Agendamento não encontrado.'));

    if (sub === 'ver') {
      const s = (await ctx.schedules.get(interaction.guildId, id))!;
      const deliveries = await ctx.schedules.recentDeliveries(id);
      const embed = new EmbedBuilder()
        .setTitle(`Agendamento ${id.slice(-8)}`)
        .setColor(0x8b6f3a)
        .setDescription(summary(s))
        .addFields(
          {
            name: 'Referência local',
            value: `${s.startLocal.replace('T', ' ')} (${s.timezone})`,
            inline: true,
          },
          { name: 'Criado por', value: `<@${s.creatorId}>`, inline: true },
          {
            name: 'Último sucesso',
            value: s.lastSuccessAt ? time(s.lastSuccessAt, TimestampStyles.ShortDateTime) : '—',
            inline: true,
          },
          ...(s.lastError
            ? [{ name: 'Último erro', value: truncate(escapeDiscord(s.lastError), 1024) }]
            : []),
          {
            name: 'Últimas entregas',
            value: deliveries.length
              ? deliveries
                  .map(
                    (d) =>
                      `\`${d.occurrenceKey}\` ${d.status}${d.attempts > 1 ? ` (${d.attempts} tentativas)` : ''}`,
                  )
                  .join('\n')
              : '—',
          },
        );
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'editar') {
      const s = (await ctx.schedules.get(interaction.guildId, id))!;
      const patch: Parameters<AppContext['schedules']['edit']>[3] = {};
      const msg = o.getString('mensagem');
      if (msg) {
        if (s.kind !== 'TEXT')
          return void (await reply('O texto de um anúncio de liturgia é gerado automaticamente.'));
        patch.payload = { ...textPayloadSchema.parse(s.payload), content: msg.replace(/\\n/g, '\n') };
      }
      const readings = o.getString('leituras');
      const saints = o.getBoolean('santos');
      const optional = o.getBoolean('memorias_facultativas');
      if (readings !== null || saints !== null || optional !== null) {
        if (s.kind !== 'LITURGY_DAILY')
          return void (await reply('Leituras/santos só se aplicam a anúncios de liturgia.'));
        const current = liturgyPayloadSchema.parse(s.payload);
        const next = liturgyPayloadSchema.parse({
          ...current,
          ...(readings !== null ? { readings } : {}),
          ...(saints !== null ? { saints } : {}),
          ...(optional !== null ? { optionalMemorials: optional } : {}),
        });
        if (next.readings === 'none' && !next.saints)
          return void (await reply('Escolha ao menos leituras ou santos.'));
        patch.payload = next;
      }
      const [d0, t0] = s.startLocal.split('T') as [string, string];
      const date = o.getString('data') ? parseBrDate(o.getString('data')!) : d0;
      const hhmm = o.getString('hora') ? parseTime(o.getString('hora')!) : t0;
      if (!date || !hhmm) return void (await reply('Data ou hora inválida.'));
      if (`${date}T${hhmm}` !== s.startLocal) patch.startLocal = `${date}T${hhmm}`;
      const rec = o.getString('recorrencia');
      if (rec) {
        if (s.kind === 'LITURGY_DAILY' && rec !== 'DAILY')
          return void (await reply('O anúncio de liturgia é sempre diário.'));
        patch.recurrence = rec as RecurrenceKind;
      }
      const channel = o.getChannel('canal', false, [...channelTypes]);
      if (channel) {
        const chErr = checkChannel(interaction, channel);
        if (chErr) return void (await reply(chErr));
        patch.channelId = channel.id;
      }
      if (o.getString('fuso')) patch.timezone = tz;
      if (!Object.keys(patch).length) return void (await reply('Nada para alterar.'));
      const res = await ctx.schedules.edit(interaction.guildId, id, interaction.user.id, patch);
      if (!res.ok) return void (await reply(res.error));
      await reply(
        `Agendamento atualizado.${res.schedule.status === 'ACTIVE' && res.next ? ` Próximo envio: ${time(res.next.runAt, TimestampStyles.LongDateTime)}.` : ''}`,
      );
      return;
    }

    const action = { cancelar: 'cancel', pausar: 'pause', retomar: 'activate' } as const;
    const op = action[sub as keyof typeof action];
    if (op === 'activate') {
      const s = await ctx.schedules.get(interaction.guildId, id);
      if (s?.status === 'ACTIVE') return void (await reply('Este agendamento já está ativo.'));
    }
    const res = await ctx.schedules[op](interaction.guildId, id, interaction.user.id);
    if (!res.ok) return void (await reply(res.error));
    const msg = {
      cancel: 'Agendamento cancelado.',
      pause: 'Agendamento pausado.',
      activate: `Agendamento retomado. Próximo envio: ${res.next ? time(res.next.runAt, TimestampStyles.LongDateTime) : '—'}.`,
    }[op];
    await reply(msg);
  },
  async autocomplete(interaction, ctx) {
    const q = interaction.options.getFocused().toLowerCase();
    const list = await ctx.schedules.list(interaction.guildId);
    await interaction.respond(
      list
        .filter((s) => s.id.toLowerCase().includes(q) || JSON.stringify(s.payload).toLowerCase().includes(q))
        .slice(0, 25)
        .map((s) => {
          const label =
            s.kind === 'LITURGY_DAILY'
              ? describeLiturgyPayload(s.payload)
              : (textPayloadSchema.safeParse(s.payload).data?.content ?? '');
          return { name: truncate(`${s.id.slice(-8)} · ${s.status} · ${label}`, 100), value: s.id };
        }),
    );
  },
};

function describeLiturgyPayload(payload: unknown): string {
  const p = liturgyPayloadSchema.safeParse(payload);
  if (!p.success) return 'Liturgia diária';
  const r = { none: '', references: 'referências', gospel: 'Evangelho', full: 'todas as leituras' }[
    p.data.readings
  ];
  return ['Liturgia diária', r, p.data.saints ? 'santos' : '', p.data.offsetDays ? 'véspera' : '']
    .filter(Boolean)
    .join(' · ');
}

/** Aceita o ID completo ou os 8 últimos caracteres exibidos nas listas. */
async function resolveId(ctx: AppContext, guildId: string, input: string): Promise<string | null> {
  const direct = await ctx.schedules.get(guildId, input.trim());
  if (direct) return direct.id;
  const all = await ctx.prisma.scheduledMessage.findMany({
    where: { guildId, id: { endsWith: input.trim() } },
    select: { id: true },
    take: 2,
  });
  return all.length === 1 ? all[0]!.id : null;
}

export const scheduleButtons: ButtonHandler = {
  prefix: 'sched',
  async execute(interaction, ctx, [action, id]) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
      return;
    if (!id) return;
    if (action === 'activate') {
      const res = await ctx.schedules.activate(interaction.guildId, id, interaction.user.id);
      await interaction.update({
        content: res.ok
          ? `✅ Agendamento \`${id.slice(-8)}\` ativado. Primeiro envio: ${time(res.next!.runAt, TimestampStyles.LongDateTime)}.`
          : `❌ ${res.error}`,
        embeds: [],
        components: [],
      });
    } else if (action === 'discard') {
      const res = await ctx.schedules.cancel(interaction.guildId, id, interaction.user.id);
      await interaction.update({
        content: res.ok ? 'Rascunho descartado.' : `❌ ${res.error}`,
        embeds: [],
        components: [],
      });
    }
  },
};
