import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../../bot/types.js';
import type { AppContext } from '../../../app/context.js';
import { BIBLE_COLOR, packEmbeds, passageEmbeds } from '../../../bot/embeds/bible.js';
import { requireMemberPermission } from '../../../bot/guards.js';
import { BOOKS } from '../domain/books.js';
import { findBook, parseSingleReference } from '../parsing/reference-parser.js';
import {
  describePassageError,
  editionAttribution,
  formatCitation,
} from '../application/passage-formatter.js';
import { escapeDiscord, truncate } from '../../../shared/discord-text.js';
import { foldPreservingLength } from '../../../shared/text-normalize.js';
import { hebrewToVulgate } from '../domain/psalms-versification.js';

const MAX_MANUAL_VERSES = 60;

const data = new SlashCommandBuilder()
  .setName('biblia')
  .setDescription('Bíblia Sagrada — tradução do Pe. Manuel de Matos Soares')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('passagem')
      .setDescription('Mostra uma passagem (ex.: João 3,16 ou Sl 22)')
      .addStringOption((o) =>
        o.setName('referencia').setDescription('Ex.: João 3,16-18').setRequired(true).setMaxLength(100),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('buscar')
      .setDescription('Busca um trecho exato (sem diferenciar acentos)')
      .addStringOption((o) =>
        o
          .setName('texto')
          .setDescription('Palavras a procurar')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(200),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('livro')
      .setDescription('Informações sobre um livro')
      .addStringOption((o) =>
        o.setName('nome').setDescription('Nome do livro').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) => s.setName('aleatorio').setDescription('Um versículo aleatório'))
  .addSubcommand((s) =>
    s
      .setName('configuracao')
      .setDescription('(Admin) Configura a detecção automática de referências')
      .addBooleanOption((o) =>
        o.setName('automatico').setDescription('Responder a referências em mensagens comuns'),
      )
      .addIntegerOption((o) =>
        o
          .setName('max_referencias')
          .setDescription('Máximo de referências por mensagem')
          .setMinValue(1)
          .setMaxValue(5),
      )
      .addIntegerOption((o) =>
        o
          .setName('cooldown')
          .setDescription('Segundos entre respostas automáticas no mesmo canal')
          .setMinValue(0)
          .setMaxValue(600),
      )
      .addStringOption((o) =>
        o
          .setName('numeracao_salmos')
          .setDescription('Como os membros numeram os Salmos ao citar')
          .addChoices(
            { name: 'Vulgata/litúrgica (Matos Soares)', value: 'vulgate' },
            { name: 'Hebraica (Bíblias modernas)', value: 'hebrew' },
          ),
      )
      .addBooleanOption((o) =>
        o.setName('citacoes').setDescription('Identificar citações coladas sem referência (beta)'),
      )
      .addChannelOption((o) =>
        o
          .setName('canal')
          .setDescription('Canal para a ação abaixo')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildForum,
            ChannelType.GuildCategory,
            ChannelType.GuildAnnouncement,
          ),
      )
      .addStringOption((o) =>
        o
          .setName('acao_canal')
          .setDescription('O que fazer com o canal informado')
          .addChoices(
            { name: 'Permitir (restringe a detecção aos permitidos)', value: 'allow' },
            { name: 'Excluir (nunca responder neste canal)', value: 'exclude' },
            { name: 'Remover das listas', value: 'remove' },
          ),
      ),
  )
  .toJSON();

export const bibliaCommand: SlashCommand = {
  data,
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'passagem':
        return passagem(interaction, ctx);
      case 'buscar':
        return buscar(interaction, ctx);
      case 'livro':
        return livro(interaction, ctx);
      case 'aleatorio':
        return aleatorio(interaction, ctx);
      case 'configuracao':
        return configuracao(interaction, ctx);
    }
  },
  async autocomplete(interaction) {
    const q = foldPreservingLength(interaction.options.getFocused());
    const choices = BOOKS.filter(
      (b) => foldPreservingLength(b.name).includes(q) || b.aliases.some((a) => a.startsWith(q)),
    )
      .slice(0, 25)
      .map((b) => ({ name: b.name, value: b.id }));
    await interaction.respond(choices);
  },
};

async function passagem(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  const input = interaction.options.getString('referencia', true);
  let ref = parseSingleReference(input);
  if (!ref) {
    await interaction.reply({
      content: 'Não reconheci a referência. Exemplos: `João 3,16`, `1 Cor 13,4-7`, `Sl 22`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const settings = await ctx.settings.get(interaction.guildId);
  if (ref.bookId === 'PSA' && settings.psalmNumbering === 'hebrew') {
    const v = hebrewToVulgate(ref.chapter);
    if (v === null) {
      await interaction.reply({
        content: `O Salmo ${ref.chapter} (numeração hebraica) não corresponde a um único salmo na Vulgata. Informe o número da Vulgata.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ref = {
      ...ref,
      chapter: v,
      ...(ref.chapterEnd !== undefined ? { chapterEnd: hebrewToVulgate(ref.chapterEnd) ?? v } : {}),
    };
  }
  const res = await ctx.bible.provider.getPassage(ref, { maxVerses: MAX_MANUAL_VERSES });
  if (!res.ok) {
    await interaction.reply({ content: describePassageError(res.error), flags: MessageFlags.Ephemeral });
    return;
  }
  const [first, ...rest] = packEmbeds(passageEmbeds(res.passage, { maxPages: 4 }));
  await interaction.reply({ embeds: first ?? [], allowedMentions: { parse: [] } });
  for (const embeds of rest) await interaction.followUp({ embeds, allowedMentions: { parse: [] } });
}

async function buscar(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  const text = interaction.options.getString('texto', true);
  const provider = ctx.bible.provider;
  if (!provider.edition) {
    await interaction.reply({
      content: describePassageError({ kind: 'edition-unavailable' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const hits = await provider.searchText(text, 10);
  if (hits.length === 0) {
    await interaction.reply({
      content: 'Nenhum versículo contém exatamente esse trecho.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = hits.map(
    ({ verse: v }) =>
      `**${formatCitation({ bookId: v.bookId, chapter: v.chapter, verseStart: v.verse })}** — ${escapeDiscord(truncate(v.text, 300))}`,
  );
  const embed = new EmbedBuilder()
    .setColor(BIBLE_COLOR)
    .setTitle(truncate(`Busca: “${text}”`, 256))
    .setDescription(truncate(lines.join('\n\n'), 4000))
    .setFooter({ text: `${hits.length === 10 ? 'Primeiros 10 resultados · ' : ''}${provider.edition.name}` });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function livro(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  const input = interaction.options.getString('nome', true);
  const book = BOOKS.find((b) => b.id === input) ?? findBook(input);
  if (!book) {
    await interaction.reply({ content: 'Livro não encontrado.', flags: MessageFlags.Ephemeral });
    return;
  }
  const info = await ctx.bible.provider.getBook(book.id);
  const embed = new EmbedBuilder()
    .setColor(BIBLE_COLOR)
    .setTitle(book.name)
    .addFields(
      { name: 'Testamento', value: book.testament === 'AT' ? 'Antigo' : 'Novo', inline: true },
      { name: 'Abreviação', value: book.abbrev, inline: true },
      { name: 'Capítulos', value: String(info?.chapters ?? book.matosSoares.chapters), inline: true },
    );
  if (book.deuterocanonical) embed.addFields({ name: 'Cânon', value: 'Deuterocanônico', inline: true });
  if (book.id === 'PSA')
    embed.setDescription(
      'Na edição de Matos Soares os Salmos seguem a numeração da Vulgata (ex.: Sl 22 = “O Senhor me apascenta”).',
    );
  embed.setFooter({ text: `Formas aceitas: ${book.aliases.join(', ')}` });
  await interaction.reply({ embeds: [embed] });
}

async function aleatorio(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  const v = await ctx.bible.provider.getRandomVerse();
  if (!v) {
    await interaction.reply({
      content: describePassageError({ kind: 'edition-unavailable' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const res = await ctx.bible.provider.getPassage({
    bookId: v.bookId,
    chapter: v.chapter,
    verseStart: v.verse,
    raw: '',
    index: 0,
  });
  if (!res.ok) {
    await interaction.reply({ content: describePassageError(res.error), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    embeds: passageEmbeds(res.passage, { maxPages: 1 }),
    allowedMentions: { parse: [] },
  });
}

async function configuracao(interaction: ChatInputCommandInteraction<'cached'>, ctx: AppContext) {
  if (!(await requireMemberPermission(interaction, PermissionFlagsBits.ManageGuild, 'Gerenciar Servidor')))
    return;
  const o = interaction.options;
  const current = await ctx.settings.get(interaction.guildId);
  const patch: Record<string, unknown> = {};
  const auto = o.getBoolean('automatico');
  if (auto !== null) patch.bibleAutoReferences = auto;
  const max = o.getInteger('max_referencias');
  if (max !== null) patch.bibleMaxReferences = max;
  const cd = o.getInteger('cooldown');
  if (cd !== null) patch.bibleCooldownSeconds = cd;
  const ps = o.getString('numeracao_salmos');
  if (ps !== null) patch.psalmNumbering = ps;
  const cit = o.getBoolean('citacoes');
  if (cit !== null) patch.quotationMatchingEnabled = cit;

  const channel = o.getChannel('canal');
  const action = o.getString('acao_canal');
  if (channel && action) {
    const allowed = new Set(current.bibleAllowedChannelIds);
    const excluded = new Set(current.bibleExcludedChannelIds);
    allowed.delete(channel.id);
    excluded.delete(channel.id);
    if (action === 'allow') allowed.add(channel.id);
    if (action === 'exclude') excluded.add(channel.id);
    patch.bibleAllowedChannelIds = [...allowed];
    patch.bibleExcludedChannelIds = [...excluded];
  } else if (channel || action) {
    await interaction.reply({
      content: 'Informe **canal** e **acao_canal** juntos.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const s =
    Object.keys(patch).length > 0
      ? await ctx.settings.update(interaction.guildId, interaction.user.id, patch)
      : current;
  const list = (ids: string[]) => (ids.length ? ids.map((id) => `<#${id}>`).join(', ') : '—');
  const edition = ctx.bible.provider.edition;
  const embed = new EmbedBuilder()
    .setColor(BIBLE_COLOR)
    .setTitle('Configuração da Bíblia')
    .addFields(
      { name: 'Detecção automática', value: s.bibleAutoReferences ? 'Ativada' : 'Desativada', inline: true },
      { name: 'Máx. referências', value: String(s.bibleMaxReferences), inline: true },
      { name: 'Cooldown', value: `${s.bibleCooldownSeconds}s`, inline: true },
      {
        name: 'Numeração dos Salmos',
        value: s.psalmNumbering === 'hebrew' ? 'Hebraica (convertida)' : 'Vulgata',
        inline: true,
      },
      {
        name: 'Identificar citações',
        value: s.quotationMatchingEnabled
          ? ctx.env.BIBLE_QUOTATION_MATCHING_ENABLED
            ? 'Ativada'
            : 'Ativada (mas desligada globalmente)'
          : 'Desativada',
        inline: true,
      },
      { name: 'Canais permitidos', value: list(s.bibleAllowedChannelIds) },
      { name: 'Canais excluídos', value: list(s.bibleExcludedChannelIds) },
      {
        name: 'Edição',
        value: edition
          ? `${edition.name}\nDireitos: \`${edition.rightsStatus}\`${edition.sourceRevision ? ` · revisão \`${edition.sourceRevision.slice(0, 10)}\`` : ''}`
          : '⚠️ Nenhuma edição importada — respostas bíblicas desativadas.',
      },
    );
  if (edition) embed.setFooter({ text: editionAttribution(edition) });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
