import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import type { MuteGateway } from './mute-gateway.js';

const isUnknownMember = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.UnknownMember || err.code === RESTJSONErrorCodes.UnknownUser);

export class DiscordMuteGateway implements MuteGateway {
  constructor(private readonly client: Client) {}

  private async member(guildId: string, userId: string) {
    const guild = await this.client.guilds.fetch(guildId);
    try {
      return await guild.members.fetch(userId);
    } catch (err) {
      if (isUnknownMember(err)) return null;
      throw err;
    }
  }

  async applyTimeout(guildId: string, userId: string, until: Date, reason: string): Promise<void> {
    const m = await this.member(guildId, userId);
    if (!m) throw new Error('Membro não está no servidor');
    await m.disableCommunicationUntil(until, reason);
  }

  async clearTimeout(guildId: string, userId: string, reason: string) {
    const m = await this.member(guildId, userId);
    if (!m) return 'member-missing' as const;
    if (m.communicationDisabledUntilTimestamp) await m.disableCommunicationUntil(null, reason);
    return 'ok' as const;
  }

  async addRole(guildId: string, userId: string, roleId: string, reason: string) {
    const m = await this.member(guildId, userId);
    if (!m) return 'member-missing' as const;
    await m.roles.add(roleId, reason);
    return 'ok' as const;
  }

  async removeRole(guildId: string, userId: string, roleId: string, reason: string) {
    const m = await this.member(guildId, userId);
    if (!m) return 'member-missing' as const;
    if (m.roles.cache.has(roleId)) await m.roles.remove(roleId, reason);
    return 'ok' as const;
  }
}
