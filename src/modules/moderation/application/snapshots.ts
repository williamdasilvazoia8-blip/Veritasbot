import { PermissionFlagsBits, type GuildMember, type PermissionResolvable } from 'discord.js';
import type { MemberSnapshot } from '../domain/permissions.js';

export function snapshot(member: GuildMember, permission: PermissionResolvable): MemberSnapshot {
  return {
    id: member.id,
    isOwner: member.guild.ownerId === member.id,
    isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    highestRolePosition: member.roles.highest.position,
    hasPermission: member.permissions.has(permission),
  };
}
