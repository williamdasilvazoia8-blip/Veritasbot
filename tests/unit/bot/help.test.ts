import { describe, expect, it } from 'vitest';
import { commands } from '../../../src/bot/commands.js';
import { HELP_CATEGORIES } from '../../../src/modules/help/help-content.js';
import { categoryEmbed, helpPage } from '../../../src/modules/help/help-command.js';

describe('/help', () => {
  it('documenta todos os comandos registados, e só esses', () => {
    const documented = HELP_CATEGORIES.flatMap((c) => c.commands).sort();
    expect(documented).toEqual(commands.map((c) => c.data.name).sort());
  });

  it('cita só subcomandos que existem', () => {
    const subs = new Map(
      commands.map((c) => [
        c.data.name,
        new Set((c.data.options ?? []).filter((o) => o.type === 1).map((o) => o.name)),
      ]),
    );
    const text = HELP_CATEGORIES.flatMap((c) => [
      c.intro,
      ...c.fields.flatMap((f) => [f.name, f.value]),
    ]).join('\n');
    for (const [, cmd, sub] of text.matchAll(/`\/([a-z-]+)(?: ([a-z_]+))?/g)) {
      expect(subs.has(cmd!), `/${cmd}`).toBe(true);
      if (sub && subs.get(cmd!)!.size > 0) expect(subs.get(cmd!)!.has(sub), `/${cmd} ${sub}`).toBe(true);
    }
  });

  it('cabe nos limites do Discord', () => {
    for (const c of HELP_CATEGORIES) {
      const e = categoryEmbed(c).data;
      const total =
        (e.title?.length ?? 0) +
        (e.description?.length ?? 0) +
        (e.footer?.text.length ?? 0) +
        (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
      expect(total, c.id).toBeLessThanOrEqual(6000);
      for (const f of c.fields) {
        expect(f.name.length, `${c.id}: ${f.name}`).toBeLessThanOrEqual(256);
        expect(f.value.length, `${c.id}: ${f.name}`).toBeLessThanOrEqual(1024);
      }
    }
  });

  it('navega por botões; a categoria aberta fica desativada', () => {
    const page = helpPage('biblia');
    const buttons = page.components.flatMap((r) => r.components.map((b) => b.toJSON()));
    expect(buttons).toHaveLength(HELP_CATEGORIES.length + 1);
    expect(buttons.find((b) => 'custom_id' in b && b.custom_id === 'help:biblia')).toMatchObject({
      disabled: true,
    });
    expect(helpPage('desconhecida').embeds[0]!.data.title).toBe('Ajuda — Veritas Bot');
  });
});
