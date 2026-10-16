import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { IANAZone } from 'luxon';
import type { SlashCommand } from '../../bot/types.js';
import { requireMemberPermission } from '../../bot/guards.js';
import { escapeDiscord } from '../../shared/discord-text.js';
import { localDate } from '../../shared/dates.js';

export const configCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('(Admin) Configurações gerais do servidor')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('ver').setDescription('Mostra as configurações'))
    .addSubcommand((s) =>
      s
        .setName('fuso')
        .setDescription('Fuso horário do servidor (liturgia de "hoje", agendamentos, mutes por mês/ano)')
        .addStringOption((o) =>
          o
            .setName('fuso')
            .setDescription('IANA, ex.: America/Sao_Paulo, Europe/Lisbon')
            .setRequired(true)
            .setMaxLength(64),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('idioma')
        .setDescription('Variante do português')
        .addStringOption((o) =>
          o
            .setName('idioma')
            .setDescription('Variante')
            .setRequired(true)
            .addChoices(
              { name: 'Português do Brasil', value: 'pt-BR' },
              { name: 'Português europeu', value: 'pt-PT' },
            ),
        ),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
      return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'fuso') {
      const tz = interaction.options.getString('fuso', true).trim();
      if (!IANAZone.isValidZone(tz)) {
        await interaction.reply({
          content: `Fuso inválido: \`${escapeDiscord(tz)}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await ctx.settings.update(interaction.guildId, interaction.user.id, { timezone: tz });
      await interaction.reply({
        content: `Fuso definido: **${tz}** (hoje lá: ${localDate(tz)}). Agendamentos existentes mantêm o próprio fuso.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === 'idioma') {
      const locale = interaction.options.getString('idioma', true);
      await ctx.settings.update(interaction.guildId, interaction.user.id, { locale });
      await interaction.reply({
        content: `Variante definida: **${locale}**. (Os textos do bot estão em pt-BR; a variante é repassada aos provedores quando suportada.)`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const s = await ctx.settings.get(interaction.guildId);
    await interaction.reply({
      content: [
        `**Fuso:** ${s.timezone}`,
        `**Idioma:** ${s.locale}`,
        `**Bíblia automática:** ${s.bibleAutoReferences ? 'sim' : 'não'} · **Citações:** ${s.quotationMatchingEnabled ? 'sim' : 'não'}`,
        `**Liturgia:** ${s.liturgyEnabled ? 'sim' : 'não'} (API ${s.liturgyApiVersion})`,
        `**Calendário:** ${s.calendarVariant}`,
        `**Logs de moderação:** ${s.modLogChannelId ? `<#${s.modLogChannelId}>` : '—'} · **Cargo silenciado:** ${s.mutedRoleId ? `<@&${s.mutedRoleId}>` : '—'}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
