import { DiscordAPIError, RESTJSONErrorCodes, type APIEmbed, type Client } from 'discord.js';
import { SendError, type MessageSender, type OutgoingMessage } from './types.js';

const PERMANENT = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.CannotSendMessagesToThisUser,
]);

export class DiscordMessageSender implements MessageSender {
  constructor(private readonly client: Client) {}

  async send(channelId: string, message: OutgoingMessage, nonce: string): Promise<{ messageId: string }> {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (err) {
      throw classify(err);
    }
    if (!channel || !channel.isSendable())
      throw new SendError('Canal inexistente ou sem suporte a mensagens', true);
    try {
      const sent = await channel.send({
        ...(message.content ? { content: message.content } : {}),
        ...(message.embeds ? { embeds: message.embeds as APIEmbed[] } : {}),
        // Nunca @everyone/@here; só os cargos explicitamente escolhidos pelo admin.
        allowedMentions: { parse: [], roles: message.allowedRoleIds },
        nonce,
        enforceNonce: true,
      });
      return { messageId: sent.id };
    } catch (err) {
      throw classify(err);
    }
  }
}

function classify(err: unknown): Error {
  if (err instanceof DiscordAPIError && typeof err.code === 'number' && PERMANENT.has(err.code)) {
    return new SendError(`Discord: ${err.message}`, true);
  }
  return err instanceof Error ? err : new Error(String(err));
}
