import { PermissionFlagsBits } from 'discord.js';

/** O que o bot pode fazer no canal da mensagem (decide embed vs. texto e reply vs. envio simples). */
export interface ReplyCapabilities {
  send: boolean;
  embeds: boolean;
  reply: boolean;
}

export function replyCapabilities(
  perms: { has(p: bigint): boolean } | null | undefined,
  isThread: boolean,
): ReplyCapabilities {
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) return { send: false, embeds: false, reply: false };
  return {
    send: perms.has(isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages),
    embeds: perms.has(PermissionFlagsBits.EmbedLinks),
    // Responder (message_reference) exige Ler histórico de mensagens.
    reply: perms.has(PermissionFlagsBits.ReadMessageHistory),
  };
}
