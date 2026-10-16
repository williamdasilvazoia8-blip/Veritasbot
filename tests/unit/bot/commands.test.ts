import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { commands } from '../../../src/bot/commands.js';

describe('definições de comandos', () => {
  it('nomes únicos, minúsculos e descrições dentro do limite', () => {
    const names = commands.map((c) => c.data.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of commands) {
      expect(c.data.name).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(c.data.description.length).toBeLessThanOrEqual(100);
    }
  });

  it('comandos de moderação/agendamento exigem permissão por padrão na interface', () => {
    const expected: Record<string, bigint> = {
      mute: PermissionFlagsBits.ModerateMembers,
      unmute: PermissionFlagsBits.ModerateMembers,
      kick: PermissionFlagsBits.KickMembers,
      ban: PermissionFlagsBits.BanMembers,
      unban: PermissionFlagsBits.BanMembers,
      purge: PermissionFlagsBits.ManageMessages,
      agendar: PermissionFlagsBits.ManageGuild,
      modlogs: PermissionFlagsBits.ManageGuild,
    };
    for (const [name, perm] of Object.entries(expected)) {
      const cmd = commands.find((c) => c.data.name === name)!;
      expect(cmd.data.default_member_permissions).toBe(perm.toString());
    }
  });

  it('agendar liturgia oferece leituras e santos', () => {
    const agendar = commands.find((c) => c.data.name === 'agendar')!;
    const sub = agendar.data.options!.find((o) => o.name === 'liturgia') as {
      options: Array<{ name: string }>;
    };
    expect(sub.options.map((o) => o.name)).toEqual(
      expect.arrayContaining(['leituras', 'santos', 'memorias_facultativas', 'vespera']),
    );
  });
});
