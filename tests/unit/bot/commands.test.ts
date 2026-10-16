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

  it('/liturgia leituras não pede número da leitura (envia todas)', () => {
    const liturgia = commands.find((c) => c.data.name === 'liturgia')!;
    const sub = liturgia.data.options!.find((o) => o.name === 'leituras') as {
      options?: Array<{ name: string }>;
    };
    expect((sub.options ?? []).map((o) => o.name)).toEqual(['dia']);
  });

  it('/agendar liturgia oferece "todas as leituras" como primeira opção', () => {
    const agendar = commands.find((c) => c.data.name === 'agendar')!;
    const sub = agendar.data.options!.find((o) => o.name === 'liturgia') as {
      options: Array<{ name: string; choices?: Array<{ value: string }> }>;
    };
    expect(sub.options.find((o) => o.name === 'leituras')!.choices![0]!.value).toBe('full');
  });

  it('/agendar angelus: canal obrigatório e horários 00h/6h/12h/18h por padrão', () => {
    const agendar = commands.find((c) => c.data.name === 'agendar')!;
    const sub = agendar.data.options!.find((o) => o.name === 'angelus') as {
      options: Array<{ name: string; required?: boolean; choices?: Array<{ value: string }> }>;
    };
    expect(sub.options.map((o) => o.name)).toEqual(['canal', 'horarios', 'fuso']);
    expect(sub.options[0]!.required).toBe(true);
    expect(sub.options[1]!.choices!.map((c) => c.value)).toEqual(['all', 'traditional', 'noon']);
  });
});
