import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Message } from 'discord.js';
import type { AppContext } from '../../../app/context.js';
import { BIBLE_COLOR, passageEmbeds, packEmbeds } from '../../../bot/embeds/bible.js';
import { formatCitation } from '../application/passage-formatter.js';
import type { AutoReply, IncomingMessage } from '../application/auto-reference-service.js';
import type { GuildSettings } from '../../guild-settings/settings-service.js';
import { unitEmbeds } from '../../references/presentation/embeds.js';
import { MAX_RANGE } from '../../references/parsing/reference-parser.js';

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

/** Handler fino: converte, delega ao serviço e responde. Nunca altera a mensagem original. */
export async function onMessageCreate(message: Message, ctx: AppContext): Promise<void> {
  if (!message.inGuild() || message.author.id === message.client.user.id) return;
  const me = message.guild.members.me;
  if (
    !me ||
    !message.channel
      .permissionsFor(me)
      ?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
  )
    return;
  if (
    message.channel.isThread() &&
    !message.channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessagesInThreads)
  )
    return;

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
  for (const batch of packEmbeds(embeds).slice(0, 3)) {
    await message.reply({ embeds: batch, allowedMentions: { parse: [], repliedUser: false } });
  }
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
