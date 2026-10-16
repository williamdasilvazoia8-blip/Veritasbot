import { describe, expect, it } from 'vitest';
import {
  composeDailyPost,
  MAX_DAILY_MESSAGES,
  saintsEmbed,
} from '../../../src/modules/liturgy/presentation/daily-post.js';
import type { LiturgicalDay } from '../../../src/modules/liturgy/domain/types.js';
import type { SaintsResult } from '../../../src/modules/calendar/application/saints-service.js';
import { embedLength } from '../../../src/shared/embed-pack.js';

const reading = (order: number, type: string, label: string, len: number) => ({
  order,
  type,
  label,
  options: [
    { reference: `Ref ${order}`, title: label, text: `[texto omitido] ${'palavra '.repeat(len / 8)}` },
  ],
});
const day = (len = 200): LiturgicalDay => ({
  date: '2026-10-16',
  source: 'dancrf-liturgia-diaria',
  sourceVersion: 'v2',
  celebrations: [
    {
      id: 'x',
      name: 'Sexta-feira da 28ª Semana do Tempo Comum',
      isPrimary: true,
      color: 'Verde',
      prayers: { extras: [] },
      antiphons: {},
      readings: [
        reading(1, 'leitura', 'Primeira Leitura', len),
        reading(2, 'salmo', 'Salmo', len),
        reading(3, 'evangelho', 'Evangelho', len),
      ],
    },
  ],
});
const saints: SaintsResult = {
  status: 'ok',
  date: '2026-10-16',
  calendar: 'GENERAL',
  locale: 'la',
  celebrations: [
    {
      key: 'StHedwig',
      name: 'Sancti Hedvigis, religiosæ',
      grade: 2,
      gradeLabel: 'memoria ad libitum',
      colors: ['albus'],
      holyDayOfObligation: false,
    },
  ],
};
const ok = (d: LiturgicalDay) => ({ status: 'ok' as const, day: d, cached: false });

describe('composeDailyPost', () => {
  it('modo referências: uma mensagem com data real, resumo e santos', () => {
    const msgs = composeDailyPost({
      date: '2026-10-16',
      heading: '📖 Liturgia de hoje',
      liturgy: ok(day()),
      saints,
      readings: 'references',
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toContain('16 de outubro de 2026');
    const embeds = msgs[0]!.embeds as Array<{ title?: string; description?: string }>;
    expect(embeds.map((e) => e.title)).toEqual([
      'Sexta-feira da 28ª Semana do Tempo Comum',
      'Santos e celebrações — Calendário Romano Geral',
    ]);
    expect(embeds[1]!.description).toContain('Sancti Hedvigis');
  });

  it('modo Evangelho acrescenta só o Evangelho', () => {
    const msgs = composeDailyPost({
      date: '2026-10-16',
      heading: 'h',
      liturgy: ok(day()),
      saints: null,
      readings: 'gospel',
    });
    const titles = msgs
      .flatMap((m) => (m.embeds ?? []) as Array<{ title?: string }>)
      .map((e) => e.title ?? '');
    expect(titles.some((t) => t.startsWith('Evangelho'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Primeira Leitura'))).toBe(false);
  });

  it('modo completo divide em mensagens dentro dos limites do Discord', () => {
    const msgs = composeDailyPost({
      date: '2026-10-16',
      heading: 'h',
      liturgy: ok(day(5000)),
      saints,
      readings: 'full',
    });
    expect(msgs.length).toBeGreaterThan(1);
    expect(msgs.length).toBeLessThanOrEqual(MAX_DAILY_MESSAGES + 1);
    for (const m of msgs) {
      const embeds = (m.embeds ?? []) as Parameters<typeof embedLength>[0][];
      expect(embeds.length).toBeLessThanOrEqual(10);
      expect(embeds.reduce((n, e) => n + embedLength(e), 0)).toBeLessThanOrEqual(6000);
      expect(m.allowedRoleIds).toEqual([]);
    }
  });

  it('liturgia indisponível gera aviso honesto e mantém os santos', () => {
    const msgs = composeDailyPost({
      date: '2026-10-16',
      heading: 'h',
      liturgy: { status: 'not-found', date: '2026-10-16' },
      saints,
      readings: 'full',
    });
    const embeds = msgs[0]!.embeds as Array<{ description?: string }>;
    expect(embeds[0]!.description).toMatch(/não encontrada/i);
    expect(embeds[1]!.description).toContain('Hedvigis');
  });

  it('dia sem santos e LitCal indisponível', () => {
    expect(saintsEmbed({ ...saints, celebrations: [] }).description).toContain('Féria');
    expect(saintsEmbed({ status: 'error', date: 'x', message: 'down' }).description).toContain(
      'indisponível',
    );
  });
});
