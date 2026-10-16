import { EmbedBuilder, PermissionFlagsBits, type Client } from 'discord.js';
import type { GuildSettingsService } from '../../guild-settings/settings-service.js';
import type { Logger } from '../../../shared/logger.js';
import { escapeDiscord, truncate } from '../../../shared/discord-text.js';

export interface ModLogEntry {
  guildId: string;
  title: string;
  color?: number;
  targetId?: string;
  actorId?: string;
  reason?: string;
  fields?: Array<{ name: string; value: string }>;
}

/** Registro privado no canal de logs configurado (/modlogs). Falhas não interrompem a ação. */
export class ModLogService {
  constructor(
    private readonly client: Client,
    private readonly settings: GuildSettingsService,
    private readonly logger: Logger,
  ) {}

  async post(entry: ModLogEntry): Promise<void> {
    try {
      const { modLogChannelId } = await this.settings.get(entry.guildId);
      if (!modLogChannelId) return;
      const channel = await this.client.channels.fetch(modLogChannelId).catch(() => null);
      if (!channel?.isSendable() || channel.isDMBased()) return;
      const me = channel.guild.members.me;
      if (
        !me ||
        !channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
      )
        return;
      const embed = new EmbedBuilder()
        .setColor(entry.color ?? 0x546e7a)
        .setTitle(truncate(entry.title, 256))
        .setTimestamp(new Date());
      if (entry.targetId)
        embed.addFields({
          name: 'Alvo',
          value: `<@${entry.targetId}> (\`${entry.targetId}\`)`,
          inline: true,
        });
      if (entry.actorId) embed.addFields({ name: 'Moderador', value: `<@${entry.actorId}>`, inline: true });
      if (entry.reason)
        embed.addFields({ name: 'Motivo', value: truncate(escapeDiscord(entry.reason), 1024) });
      for (const f of entry.fields ?? []) embed.addFields({ name: f.name, value: truncate(f.value, 1024) });
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, guildId: entry.guildId },
        'Falha ao enviar log de moderação',
      );
    }
  }
}
