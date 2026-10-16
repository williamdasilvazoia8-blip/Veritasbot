import { ChannelType, EmbedBuilder, type Message } from 'discord.js';
import type { AppContext } from '../../../app/context.js';
import { BIBLE_COLOR, passageEmbeds, packEmbeds } from '../../../bot/embeds/bible.js';
import { formatCitation } from '../application/passage-formatter.js';
import type { AutoReply, IncomingMessage } from '../application/auto-reference-service.js';
import type { GuildSettings } from '../../guild-settings/settings-service.js';
import { unitEmbeds } from '../../references/presentation/embeds.js';
import { MAX_RANGE } from '../../references/parsing/reference-parser.js';
import { DISCORD_LIMITS, splitText } from '../../../shared/discord-text.js';
import { replyCapabilities } from '../../../bot/reply-capabilities.js';

export function toIncoming(message: Message<true>): IncomingMessage {
  const ch = message.channel;
  const parent = ch.isThread() ? ch.parentId : ch.type === ChannelType.GuildText ? ch.parentId : null;
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId: parent,
    content: message.content,
    authorIsBot: message.author.bot,
    isWebhook: Boolean(message.webhookId),
    isSystem: message.system,
  };
}

export function settingsToAuto(s: GuildSettings) {
  return {
    enabled: s.bibleAutoReferences,
    allowedChannelIds: s.bibleAllowedChannelIds,
    excludedChannelIds: s.bibleExcludedChannelIds,
    maxReferences: s.bibleMaxReferences,
    cooldownSeconds: s.bibleCooldownSeconds,
    allowWebhookMessages: s.allowWebhookMessages,
    psalmNumbering: s.psalmNumbering,
    quotationMatchingEnabled: s.quotationMatchingEnabled,
    quotationMinWords: s.quotationMinWords,
    quotationChannelIds: s.quotationChannelIds,
  };
}

const warnedChannels = new Map<string, number>();

/** Handler fino: converte, delega ao serviço e responde. Nunca altera a mensagem original. */
export async function onMessageCreate(message: Message, ctx: AppContext): Promise<void> {
  if (!message.inGuild() || message.author.id === message.client.user.id) return;
  // Em servidores grandes o próprio membro do bot pode não estar em cache.
  const me = message.guild.members.me ?? (await message.guild.members.fetchMe().catch(() => null));
  const can = replyCapabilities(me ? message.channel.permissionsFor(me) : null, message.channel.isThread());
  if (!can.send) return;

  const settings = await ctx.settings.get(message.guildId);
  const incoming = toIncoming(message);
  const auto = settingsToAuto(settings);
  const reply = await ctx.autoReferences.handle(incoming, auto);
  // Catecismo / Código ("CCC 1234", "cân. 1055"): mesmas regras de canal e cooldown.
  const documents = ctx.documentReplies.handle(incoming, auto);
  const embeds = [
    ...(reply ? buildEmbeds(reply) : []),
    ...documents.flatMap((d) =>
      unitEmbeds(d.reference.documentId, d.units, {
        missing: d.missing,
        ...(d.reference.requestedEnd > d.reference.end
          ? {
              note: `Mostrando só os primeiros ${MAX_RANGE}; use /${d.reference.documentId === 'ccc' ? 'catecismo' : 'direito-canonico'} para o resto.`,
            }
          : {}),
      }),
    ),
  ];
  if (embeds.length === 0) return;

  if (!can.embeds || !can.reply) {
    const now = Date.now();
    if (now - (warnedChannels.get(message.channelId) ?? 0) > 60 * 60_000) {
      warnedChannels.set(message.channelId, now);
      ctx.logger.warn(
        { guildId: message.guildId, channelId: message.channelId, embeds: can.embeds, reply: can.reply },
        'Permissões limitadas no canal: respondendo em texto simples e/ou sem citar a mensagem',
      );
    }
  }
  const payloads = can.embeds
    ? packEmbeds(embeds).map((batch) => ({ embeds: batch }))
    : embedsToText(embeds).map((content) => ({ content }));
  for (const payload of payloads.slice(0, 3)) {
    const options = { ...payload, allowedMentions: { parse: [], repliedUser: false } };
    if (can.reply) await message.reply(options);
    else await message.channel.send(options);
  }
}

/** Sem "Inserir links" o Discord descarta embeds: converte para texto (blocos ≤ 2000). */
export function embedsToText(embeds: EmbedBuilder[]): string[] {
  const text = embeds
    .map((e) => {
      const d = e.data;
      return [d.title ? `**${d.title}**` : '', d.description ?? '', d.footer ? `-# ${d.footer.text}` : '']
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
  return splitText(text, DISCORD_LIMITS.messageContent);
}

function buildEmbeds(reply: AutoReply) {
  if (reply.kind === 'quotation')
    return passageEmbeds(reply.passage, { maxPages: 1, heading: 'Citação identificada' });
  const embeds = reply.passages.flatMap((p) => passageEmbeds(p, { maxPages: 2 }));
  if (reply.truncated.length > 0) {
    const [first] = embeds;
    const note = reply.truncated
      .map((t) => `${formatCitation(t.reference)} (${t.verseCount} versículos)`)
      .join(', ');
    const text = `Passagem longa demais para resposta automática: ${note}. Use \`/biblia passagem\` com um trecho menor.`;
    if (first) first.setDescription(`${first.data.description ?? ''}\n\n-# ${text}`.slice(0, 4096));
    else return [buildNotice(text)];
  }
  return embeds;
}

function buildNotice(text: string): EmbedBuilder {
  return new EmbedBuilder().setColor(BIBLE_COLOR).setDescription(text);
}
