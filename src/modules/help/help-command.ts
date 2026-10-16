import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { ButtonHandler, SlashCommand } from '../../bot/types.js';
import { DISCORD_LIMITS, truncate } from '../../shared/discord-text.js';
import { findCategory, HELP_CATEGORIES, type HelpCategory } from './help-content.js';

const HELP_COLOR = 0x5c6bc0;
const HOME = 'inicio';

function homeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setTitle('Ajuda — Veritas Bot')
    .setDescription(
      [
        'Bot católico para servidores de língua portuguesa. Escolha uma categoria nos botões abaixo ' +
          '(ou use `/help categoria:`).',
        '',
        ...HELP_CATEGORIES.map((c) => `${c.emoji} **${c.label}** — ${c.summary}`),
        '',
        '-# Dica: muitas funções não precisam de comando — basta escrever `João 3,16`, `CCC 1234` ou `cân. 1055` numa mensagem.',
      ].join('\n'),
    )
    .setFooter({ text: '🔒 = só para quem tem a permissão indicada' });
}

export function categoryEmbed(c: HelpCategory): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setTitle(`${c.emoji} ${c.label}`)
    .setDescription(truncate(c.intro, DISCORD_LIMITS.embedDescription))
    .addFields(
      c.fields.map((f) => ({
        name: truncate(f.name, DISCORD_LIMITS.embedFieldName),
        value: truncate(f.value, DISCORD_LIMITS.embedFieldValue),
      })),
    )
    .setFooter({ text: 'Veritas Bot · /help para voltar ao início' });
}

/** Botões de navegação (máx. 5 por linha); a categoria aberta fica destacada e desativada. */
function navigation(active: string) {
  const all = [{ id: HOME, label: 'Início', emoji: '🏠' }, ...HELP_CATEGORIES];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < all.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        all.slice(i, i + 5).map((c) =>
          new ButtonBuilder()
            .setCustomId(`help:${c.id}`)
            .setLabel(c.label)
            .setEmoji(c.emoji)
            .setStyle(c.id === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(c.id === active),
        ),
      ),
    );
  }
  return rows;
}

export function helpPage(id: string) {
  const category = findCategory(id);
  return {
    embeds: [category ? categoryEmbed(category) : homeEmbed()],
    components: navigation(category ? category.id : HOME),
  };
}

export const helpCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Como usar o bot: comandos, formatos aceitos e limites, por categoria')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('categoria')
        .setDescription('Abrir direto numa categoria')
        .addChoices(...HELP_CATEGORIES.map((c) => ({ name: `${c.emoji} ${c.label}`, value: c.id }))),
    )
    .toJSON(),
  async execute(interaction) {
    // Efêmera: só quem pediu vê, e os botões só funcionam para essa pessoa.
    await interaction.reply({
      ...helpPage(interaction.options.getString('categoria') ?? HOME),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const helpButtons: ButtonHandler = {
  prefix: 'help',
  async execute(interaction, _ctx, [id]) {
    await interaction.update(helpPage(id ?? HOME));
  },
};
