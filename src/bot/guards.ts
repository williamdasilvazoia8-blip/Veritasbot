import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type PermissionResolvable,
} from 'discord.js';

/**
 * Verificação de permissão NO SERVIDOR (não confiamos só em default_member_permissions,
 * que administradores podem alterar na interface do Discord).
 */
export async function requireMemberPermission(
  interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>,
  permission: PermissionResolvable,
  label: string,
): Promise<boolean> {
  if (interaction.memberPermissions.has(permission)) return true;
  await interaction.reply({
    content: `Você não tem permissão para isso (requer **${label}**).`,
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function replyEphemeral(
  interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>,
  content: string,
): Promise<void> {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}
