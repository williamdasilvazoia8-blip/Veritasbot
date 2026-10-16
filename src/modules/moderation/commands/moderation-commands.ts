import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
  type GuildMember,
  type PermissionResolvable,
  type SlashCommandStringOption,
} from 'discord.js';
import type { SlashCommand } from '../../../bot/types.js';
import type { AppContext } from '../../../app/context.js';
import { requireMemberPermission } from '../../../bot/guards.js';
import { checkModerationHierarchy, checkRoleMute } from '../domain/permissions.js';
import { snapshot } from '../application/snapshots.js';
import { escapeDiscord } from '../../../shared/discord-text.js';

const reasonOpt = (o: SlashCommandStringOption) =>
  o.setName('motivo').setDescription('Motivo (fica registrado)').setMaxLength(400);
const ephemeral = (interaction: ChatInputCommandInteraction<'cached'>, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

async function hierarchy(
  interaction: ChatInputCommandInteraction<'cached'>,
  target: GuildMember | null,
  permission: PermissionResolvable,
  label: string,
): Promise<boolean> {
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  const res = checkModerationHierarchy({
    actor: snapshot(interaction.member, permission),
    bot: snapshot(me, permission),
    target: target ? snapshot(target, permission) : null,
    permissionLabel: label,
  });
  if (!res.ok) await ephemeral(interaction, res.reason);
  return res.ok;
}

async function fetchMember(
  interaction: ChatInputCommandInteraction<'cached'>,
  userId: string,
): Promise<GuildMember | null> {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

// ---------------------------------------------------------------- /mute
const muteCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Silencia um membro por um período (s, min, h, d, sem, mo, y)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duracao')
        .setDescription('Ex.: 30s, 10min, 2h, 7d, 1mo, 1y, 1d12h')
        .setRequired(true)
        .setMaxLength(30),
    )
    .addStringOption(reasonOpt)
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('usuario', true);
    const target = await fetchMember(interaction, user.id);
    if (!target) return void (await ephemeral(interaction, 'Membro não encontrado neste servidor.'));
    if (!(await hierarchy(interaction, target, PermissionFlagsBits.ModerateMembers, 'Moderar Membros')))
      return;
    const settings = await ctx.settings.get(interaction.guildId);
    const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';
    const me = interaction.guild.members.me!;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await ctx.mutes.mute({
      guildId: interaction.guildId,
      targetUserId: target.id,
      actorUserId: interaction.user.id,
      reason,
      durationInput: interaction.options.getString('duracao', true),
      timezone: settings.timezone,
      mutedRoleId: settings.mutedRoleId,
      precheck: async (mechanism) => {
        if (mechanism === 'NATIVE_TIMEOUT') {
          if (target.permissions.has(PermissionFlagsBits.Administrator))
            return 'O Discord não permite timeout de membros com **Administrador**.';
          return null;
        }
        const role = settings.mutedRoleId
          ? (interaction.guild.roles.cache.get(settings.mutedRoleId) ?? null)
          : null;
        const check = checkRoleMute({
          target: snapshot(target, PermissionFlagsBits.ModerateMembers),
          mutedRole: role ? { id: role.id, position: role.position } : null,
          botHighestRolePosition: me.roles.highest.position,
          botCanManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
        });
        return check.ok ? null : check.reason;
      },
    });
    if (!result.ok) return void (await interaction.editReply({ content: result.error }));

    const a = result.action;
    let warning = '';
    if (a.mechanism === 'MUTED_ROLE') {
      // Verifica a restrição efetiva: canais onde o alvo ainda consegue escrever.
      const fresh = await interaction.guild.members.fetch(target.id);
      const writable = interaction.guild.channels.cache.filter(
        (c) =>
          c.isTextBased() &&
          !c.isThread() &&
          c.permissionsFor(fresh).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
      );
      if (writable.size > 0) {
        warning = `\n⚠️ O membro ainda pode escrever em ${writable.size} canal(is) (sobrescritas específicas ou cargo sem restrição). Revise com \`/configurar-silenciado\`.`;
      }
    }
    const mech = a.mechanism === 'NATIVE_TIMEOUT' ? 'timeout nativo do Discord' : 'cargo de silenciado';
    await interaction.editReply({
      content: `🔇 <@${target.id}> silenciado por ${result.durationLabel} (até ${time(a.expiresAt!, TimestampStyles.LongDateTime)}) via ${mech}.${result.superseded ? ' O silenciamento anterior foi substituído.' : ''}${warning}`,
      allowedMentions: { parse: [] },
    });
    await ctx.audit.record({
      guildId: interaction.guildId,
      action: 'moderation.mute',
      actorUserId: interaction.user.id,
      targetId: target.id,
      metadata: { actionId: a.id, mechanism: a.mechanism, expiresAt: a.expiresAt },
    });
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '🔇 Membro silenciado',
      color: 0xf9a825,
      targetId: target.id,
      actorId: interaction.user.id,
      reason,
      fields: [
        { name: 'Até', value: time(a.expiresAt!, TimestampStyles.LongDateTime) },
        { name: 'Mecanismo', value: mech },
      ],
    });
  },
};

// ---------------------------------------------------------------- /unmute
const unmuteCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove o silenciamento de um membro')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
    .addStringOption(reasonOpt)
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('usuario', true);
    const target = await fetchMember(interaction, user.id);
    if (!(await hierarchy(interaction, target, PermissionFlagsBits.ModerateMembers, 'Moderar Membros')))
      return;
    const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';
    const released = await ctx.mutes.unmute(interaction.guildId, user.id, interaction.user.id, reason);
    if (!released) {
      // Sem registro ativo: ainda assim remove um timeout nativo aplicado fora do bot.
      if (
        target?.communicationDisabledUntilTimestamp &&
        target.communicationDisabledUntilTimestamp > Date.now()
      ) {
        await target.disableCommunicationUntil(null, reason);
        return void (await ephemeral(
          interaction,
          `Timeout nativo de <@${user.id}> removido (não havia registro do bot).`,
        ));
      }
      return void (await ephemeral(interaction, 'Este membro não tem silenciamento ativo registrado.'));
    }
    await ephemeral(interaction, `🔊 Silenciamento de <@${user.id}> removido.`);
    await ctx.audit.record({
      guildId: interaction.guildId,
      action: 'moderation.unmute',
      actorUserId: interaction.user.id,
      targetId: user.id,
      metadata: { actionId: released.id },
    });
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '🔊 Silenciamento removido',
      color: 0x43a047,
      targetId: user.id,
      actorId: interaction.user.id,
      reason,
    });
  },
};

// ---------------------------------------------------------------- /mute-status
const muteStatusCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('mute-status')
    .setDescription('Situação de silenciamento e histórico recente de um membro')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderar Membros')))
      return;
    const user = interaction.options.getUser('usuario', true);
    const active = await ctx.mutes.activeMute(interaction.guildId, user.id);
    const history = await ctx.mutes.history(interaction.guildId, user.id, 8);
    const embed = new EmbedBuilder()
      .setTitle(`Moderação — ${escapeDiscord(user.username)}`)
      .setColor(active ? 0xf9a825 : 0x43a047)
      .addFields({
        name: 'Silenciamento ativo',
        value: active
          ? `Sim, até ${time(active.expiresAt!, TimestampStyles.LongDateTime)} (${active.mechanism === 'NATIVE_TIMEOUT' ? 'timeout nativo' : 'cargo'})\nMotivo: ${escapeDiscord(active.reason)}`
          : 'Não',
      });
    if (history.length) {
      embed.addFields({
        name: 'Histórico recente',
        value: history
          .map(
            (h) =>
              `${time(h.createdAt, TimestampStyles.ShortDate)} · ${h.type} · ${h.status}${h.durationInput ? ` · ${h.durationInput}` : ''}`,
          )
          .join('\n')
          .slice(0, 1024),
      });
    }
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

// ---------------------------------------------------------------- /kick, /ban, /unban
async function recordSimple(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction<'cached'>,
  type: 'KICK' | 'BAN' | 'UNBAN' | 'PURGE',
  targetId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  await ctx.prisma.moderationAction.create({
    data: {
      guildId: interaction.guildId,
      type,
      targetUserId: targetId,
      actorUserId: interaction.user.id,
      reason,
      status: 'COMPLETED',
      metadata: metadata as object,
    },
  });
  await ctx.audit.record({
    guildId: interaction.guildId,
    action: `moderation.${type.toLowerCase()}`,
    actorUserId: interaction.user.id,
    targetId,
    metadata,
  });
}

const kickCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa um membro')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
    .addStringOption(reasonOpt)
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('usuario', true);
    const target = await fetchMember(interaction, user.id);
    if (!target) return void (await ephemeral(interaction, 'Membro não encontrado neste servidor.'));
    if (!(await hierarchy(interaction, target, PermissionFlagsBits.KickMembers, 'Expulsar Membros'))) return;
    const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';
    await target.kick(reason);
    await recordSimple(ctx, interaction, 'KICK', user.id, reason);
    await ephemeral(interaction, `👢 <@${user.id}> foi expulso.`);
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '👢 Membro expulso',
      color: 0xef6c00,
      targetId: user.id,
      actorId: interaction.user.id,
      reason,
    });
  },
};

const banCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um usuário')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('usuario').setDescription('Usuário').setRequired(true))
    .addStringOption(reasonOpt)
    .addIntegerOption((o) =>
      o
        .setName('apagar_dias')
        .setDescription('Apagar mensagens dos últimos N dias (0–7)')
        .setMinValue(0)
        .setMaxValue(7),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('usuario', true);
    const target = await fetchMember(interaction, user.id);
    if (!(await hierarchy(interaction, target, PermissionFlagsBits.BanMembers, 'Banir Membros'))) return;
    if (!target && user.id === interaction.user.id)
      return void (await ephemeral(interaction, 'Você não pode banir a si mesmo.'));
    const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';
    const days = interaction.options.getInteger('apagar_dias') ?? 0;
    await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: days * 86_400 });
    await recordSimple(ctx, interaction, 'BAN', user.id, reason, { deleteMessageDays: days });
    await ephemeral(interaction, `🔨 <@${user.id}> foi banido.`);
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '🔨 Usuário banido',
      color: 0xc62828,
      targetId: user.id,
      actorId: interaction.user.id,
      reason,
    });
  },
};

const unbanCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove o banimento de um usuário')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) =>
      o
        .setName('usuario')
        .setDescription('ID do usuário')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20),
    )
    .addStringOption(reasonOpt)
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await hierarchy(interaction, null, PermissionFlagsBits.BanMembers, 'Banir Membros'))) return;
    const id = interaction.options.getString('usuario', true).trim();
    if (!/^\d{17,20}$/.test(id))
      return void (await ephemeral(interaction, 'Informe um ID de usuário válido.'));
    const reason = interaction.options.getString('motivo') ?? 'Sem motivo informado';
    const ban = await interaction.guild.bans.fetch(id).catch(() => null);
    if (!ban) return void (await ephemeral(interaction, 'Este usuário não está banido.'));
    await interaction.guild.members.unban(id, reason);
    await recordSimple(ctx, interaction, 'UNBAN', id, reason);
    await ephemeral(interaction, `Banimento de <@${id}> removido.`);
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '♻️ Banimento removido',
      color: 0x43a047,
      targetId: id,
      actorId: interaction.user.id,
      reason,
    });
  },
};

// ---------------------------------------------------------------- /purge
const purgeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Apaga mensagens recentes deste canal (até 100, com menos de 14 dias)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('quantidade').setDescription('1–100').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('usuario').setDescription('Apagar apenas mensagens deste usuário'))
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await hierarchy(interaction, null, PermissionFlagsBits.ManageMessages, 'Gerenciar Mensagens')))
      return;
    const channel = interaction.channel;
    if (!channel || !('bulkDelete' in channel))
      return void (await ephemeral(interaction, 'Use este comando em um canal de texto.'));
    const me = interaction.guild.members.me!;
    if (
      !channel
        .permissionsFor(me)
        .has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])
    ) {
      return void (await ephemeral(
        interaction,
        'O bot precisa de **Gerenciar Mensagens** e **Ler Histórico** neste canal.',
      ));
    }
    const amount = interaction.options.getInteger('quantidade', true);
    const user = interaction.options.getUser('usuario');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const fetched = await channel.messages.fetch({ limit: 100 });
    const selected = [...fetched.filter((m) => !user || m.author.id === user.id).values()].slice(0, amount);
    // filterOld: o Discord não apaga em massa mensagens com mais de 14 dias.
    const deleted = await channel.bulkDelete(selected, true);
    await recordSimple(ctx, interaction, 'PURGE', user?.id ?? channel.id, `purge ${deleted.size}`, {
      channelId: channel.id,
      requested: amount,
      deleted: deleted.size,
    });
    await interaction.editReply({
      content: `🧹 ${deleted.size} mensagem(ns) apagada(s).${deleted.size < selected.length ? ' Mensagens com mais de 14 dias não podem ser apagadas em massa.' : ''}`,
    });
    await ctx.modLog.post({
      guildId: interaction.guildId,
      title: '🧹 Mensagens apagadas',
      actorId: interaction.user.id,
      fields: [
        { name: 'Canal', value: `<#${channel.id}>` },
        { name: 'Quantidade', value: String(deleted.size) },
      ],
    });
  },
};

// ---------------------------------------------------------------- /modlogs
const modlogsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('Define o canal privado de registros de moderação')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('canal')
        .setDescription('Canal de logs')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
      return;
    const channel = interaction.options.getChannel('canal', true, [ChannelType.GuildText]);
    const me = interaction.guild.members.me!;
    if (!channel.permissionsFor(me).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return void (await ephemeral(interaction, 'O bot não pode enviar mensagens/embeds nesse canal.'));
    }
    if (channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionFlagsBits.ViewChannel)) {
      await ctx.settings.update(interaction.guildId, interaction.user.id, { modLogChannelId: channel.id });
      return void (await ephemeral(
        interaction,
        `Canal de logs definido para <#${channel.id}>. ⚠️ Atenção: @everyone pode ver este canal; recomenda-se um canal privado.`,
      ));
    }
    await ctx.settings.update(interaction.guildId, interaction.user.id, { modLogChannelId: channel.id });
    await ephemeral(interaction, `Canal de logs definido para <#${channel.id}>.`);
  },
};

// ---------------------------------------------------------------- /configurar-silenciado
const MUTED_DENY = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.SendVoiceMessages,
  PermissionFlagsBits.SendPolls,
  PermissionFlagsBits.RequestToSpeak,
];

const configureMutedCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('configurar-silenciado')
    .setDescription('(Admin) Cria/configura o cargo usado em silenciamentos acima de 28 dias')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((o) =>
      o.setName('cargo').setDescription('Cargo existente (se omitido, cria "Silenciado")'),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
      return;
    const me = interaction.guild.members.me!;
    if (!me.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) {
      return void (await ephemeral(
        interaction,
        'O bot precisa de **Gerenciar Cargos** e **Gerenciar Canais** para configurar o cargo.',
      ));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let role = interaction.options.getRole('cargo');
    if (role && role.position >= me.roles.highest.position) {
      return void (await interaction.editReply('Esse cargo está acima do cargo do bot.'));
    }
    if (role?.permissions.has(PermissionFlagsBits.Administrator)) {
      return void (await interaction.editReply('O cargo de silenciado não pode ter Administrador.'));
    }
    role ??= await interaction.guild.roles.create({
      name: 'Silenciado',
      permissions: [],
      reason: `Configurado por ${interaction.user.tag}`,
    });

    let ok = 0;
    const failed: string[] = [];
    for (const channel of interaction.guild.channels.cache.values()) {
      if (channel.isThread() || !('permissionOverwrites' in channel)) continue;
      try {
        await channel.permissionOverwrites.edit(
          role.id,
          Object.fromEntries(MUTED_DENY.map((p) => [permName(p), false])),
          {
            type: OverwriteType.Role,
            reason: 'Cargo de silenciado',
          },
        );
        ok++;
      } catch {
        failed.push(channel.name);
      }
    }
    await ctx.settings.update(interaction.guildId, interaction.user.id, { mutedRoleId: role.id });
    await interaction.editReply({
      content: [
        `Cargo de silenciado: <@&${role.id}>. Restrições aplicadas em ${ok} canal(is)/categoria(s).`,
        failed.length
          ? `⚠️ Falhou em: ${failed.slice(0, 10).map(escapeDiscord).join(', ')}${failed.length > 10 ? '…' : ''}`
          : '',
        'Limitações: o cargo não restringe membros com Administrador nem canais cujas sobrescritas de membro/cargo concedam envio explicitamente. Canais criados depois exigem rodar este comando de novo.',
      ]
        .filter(Boolean)
        .join('\n'),
      allowedMentions: { parse: [] },
    });
  },
};

function permName(bit: bigint): string {
  const entry = Object.entries(PermissionFlagsBits).find(([, v]) => v === bit);
  if (!entry) throw new Error(`Permissão desconhecida: ${bit}`);
  return entry[0];
}

export const moderationCommands: SlashCommand[] = [
  muteCommand,
  unmuteCommand,
  muteStatusCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  purgeCommand,
  modlogsCommand,
  configureMutedCommand,
];
