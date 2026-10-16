import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../../bot/types.js';
import type { AppContext } from '../../../app/context.js';
import { packEmbeds } from '../../../bot/embeds/bible.js';
import { DISCORD_LIMITS, escapeDiscord, truncate } from '../../../shared/discord-text.js';
import { DOCUMENTS, type ReferenceDocumentId } from '../domain/types.js';
import { MAX_RANGE } from '../parsing/reference-parser.js';
import { DOCUMENT_COLORS, documentAttribution, unitEmbeds } from '../presentation/embeds.js';

/** Lista de servidores autorizada (REFERENCE_TEXTS_GUILD_IDS); vazia = todos. */
export function referencesAllowed(ctx: Pick<AppContext, 'env'>, guildId: string): boolean {
  const { REFERENCE_TEXTS_ENABLED: enabled, REFERENCE_TEXTS_GUILD_IDS: guilds } = ctx.env;
  return enabled && (guilds.length === 0 || guilds.includes(guildId));
}

interface CommandSpec {
  id: ReferenceDocumentId;
  name: string;
  description: string;
  unitSub: string;
  unitSubDescription: string;
  unitWord: string;
}

function buildCommand(spec: CommandSpec): SlashCommand {
  const max = DOCUMENTS[spec.id].maxNumber;
  const data = new SlashCommandBuilder()
    .setName(spec.name)
    .setDescription(spec.description)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName(spec.unitSub)
        .setDescription(spec.unitSubDescription)
        .addIntegerOption((o) =>
          o
            .setName('numero')
            .setDescription(`Número (1-${max})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(max),
        )
        .addIntegerOption((o) =>
          o
            .setName('ate')
            .setDescription(`Último número do intervalo (até ${MAX_RANGE} de cada vez)`)
            .setMinValue(1)
            .setMaxValue(max),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('buscar')
        .setDescription('Procura palavras no texto (sem diferenciar acentos)')
        .addStringOption((o) =>
          o
            .setName('texto')
            .setDescription('Palavras a procurar')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(100),
        ),
    )
    .toJSON();

  return {
    data,
    async execute(interaction, ctx) {
      if (!referencesAllowed(ctx, interaction.guildId)) {
        await interaction.reply({
          content: `O ${DOCUMENTS[spec.id].name} não está disponível neste servidor.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!ctx.references.has(spec.id)) {
        await interaction.reply({
          content: `O ${DOCUMENTS[spec.id].name} ainda não foi importado neste bot (admin: \`node dist/scripts/import-references.js\`).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.options.getSubcommand() === 'buscar') return search(interaction, ctx, spec);
      return lookup(interaction, ctx, spec);
    },
  };
}

async function lookup(
  interaction: ChatInputCommandInteraction<'cached'>,
  ctx: AppContext,
  spec: CommandSpec,
) {
  const start = interaction.options.getInteger('numero', true);
  const requestedEnd = interaction.options.getInteger('ate') ?? start;
  if (requestedEnd < start) {
    await interaction.reply({
      content: 'O fim do intervalo é menor que o início.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const end = Math.min(requestedEnd, start + MAX_RANGE - 1);
  const res = ctx.references.get(spec.id, start, end);
  if (!res.ok) {
    const max = DOCUMENTS[spec.id].maxNumber;
    const content =
      res.error === 'out-of-range'
        ? `O ${DOCUMENTS[spec.id].name} vai de 1 a ${max}.`
        : `Não há texto para ${spec.unitWord} ${start}${end > start ? `-${end}` : ''} na fonte importada.`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  const note =
    end < requestedEnd ? `Mostrando só ${start}-${end} (máximo ${MAX_RANGE} de cada vez).` : undefined;
  const [first, ...rest] = packEmbeds(
    unitEmbeds(spec.id, res.units, { missing: res.missing, ...(note ? { note } : {}) }),
  );
  await interaction.reply({ embeds: first ?? [], allowedMentions: { parse: [] } });
  for (const embeds of rest) await interaction.followUp({ embeds, allowedMentions: { parse: [] } });
}

async function search(
  interaction: ChatInputCommandInteraction<'cached'>,
  ctx: AppContext,
  spec: CommandSpec,
) {
  const text = interaction.options.getString('texto', true);
  const hits = ctx.references.search(spec.id, text, 10);
  if (hits.length === 0) {
    await interaction.reply({
      content: 'Nada encontrado com essas palavras.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const label = spec.id === 'ccc' ? '§' : 'cân. ';
  const lines = hits.map(({ unit, snippet }) => `**${label}${unit.number}** — ${escapeDiscord(snippet)}`);
  const embed = new EmbedBuilder()
    .setColor(DOCUMENT_COLORS[spec.id])
    .setTitle(truncate(`${DOCUMENTS[spec.id].name} — “${text}”`, DISCORD_LIMITS.embedTitle))
    .setDescription(truncate(lines.join('\n\n'), 4000))
    .setFooter({
      text: truncate(
        `${hits.length === 10 ? 'Primeiros 10 resultados · ' : ''}${documentAttribution(spec.id)}`,
        DISCORD_LIMITS.embedFooter,
      ),
    });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

export const catecismoCommand = buildCommand({
  id: 'ccc',
  name: 'catecismo',
  description: 'Catecismo da Igreja Católica — parágrafos e busca',
  unitSub: 'paragrafo',
  unitSubDescription: 'Mostra um parágrafo ou intervalo (ex.: 1234, ou 27 até 30)',
  unitWord: '§',
});

export const direitoCanonicoCommand = buildCommand({
  id: 'cic',
  name: 'direito-canonico',
  description: 'Código de Direito Canónico — cânones e busca',
  unitSub: 'canone',
  unitSubDescription: 'Mostra um cânon ou intervalo (ex.: 1055, ou 1055 até 1057)',
  unitWord: 'cân.',
});
