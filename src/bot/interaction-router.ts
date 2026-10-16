import { MessageFlags, type Interaction } from 'discord.js';
import type { AppContext } from '../app/context.js';
import { buttons, commands } from './commands.js';

const byName = new Map(commands.map((c) => [c.data.name, c]));
const byPrefix = new Map(buttons.map((b) => [b.prefix, b]));

export async function routeInteraction(interaction: Interaction, ctx: AppContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable())
      await interaction.reply({
        content: 'Use os comandos dentro de um servidor.',
        flags: MessageFlags.Ephemeral,
      });
    return;
  }
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = byName.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction, ctx);
    } else if (interaction.isAutocomplete()) {
      const cmd = byName.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, ctx);
    } else if (interaction.isButton()) {
      const [prefix, ...args] = interaction.customId.split(':');
      const handler = byPrefix.get(prefix ?? '');
      if (handler) await handler.execute(interaction, ctx, args);
    }
  } catch (err) {
    ctx.logger.error(
      {
        err,
        command: interaction.isCommand() ? interaction.commandName : undefined,
        guildId: interaction.guildId,
      },
      'Erro ao processar interação',
    );
    if (interaction.isRepliable()) {
      const payload = {
        content: 'Ocorreu um erro inesperado. A equipe foi registrada nos logs.',
        flags: MessageFlags.Ephemeral,
      } as const;
      await (
        interaction.deferred || interaction.replied
          ? interaction.followUp(payload)
          : interaction.reply(payload)
      ).catch(() => undefined);
    }
  }
}
