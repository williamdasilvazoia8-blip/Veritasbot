import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { AppContext } from '../../../app/context.js';

export async function onGuildMemberAdd(member: GuildMember, ctx: AppContext): Promise<void> {
  const reapplied = await ctx.mutes.onMemberRejoin(member.guild.id, member.id);
  if (reapplied) {
    await ctx.modLog.post({
      guildId: member.guild.id,
      title: '🔇 Silenciamento reaplicado ao reentrar',
      targetId: member.id,
      color: 0xf9a825,
    });
  }
}

/** Detecta remoção manual (pelo Discord) do timeout ou do cargo de silenciado. */
export async function onGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
  ctx: AppContext,
): Promise<void> {
  const now = Date.now();
  const hadTimeout = (oldMember.communicationDisabledUntilTimestamp ?? 0) > now;
  const hasTimeout = (newMember.communicationDisabledUntilTimestamp ?? 0) > now;
  if (hadTimeout && !hasTimeout) {
    await ctx.mutes.onManualRemoval(newMember.guild.id, newMember.id, 'NATIVE_TIMEOUT');
  }
  if (oldMember.partial) return;
  const { mutedRoleId } = await ctx.settings.get(newMember.guild.id);
  if (mutedRoleId && oldMember.roles.cache.has(mutedRoleId) && !newMember.roles.cache.has(mutedRoleId)) {
    await ctx.mutes.onManualRemoval(newMember.guild.id, newMember.id, 'MUTED_ROLE');
  }
}
