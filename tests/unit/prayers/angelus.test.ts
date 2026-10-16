import { describe, expect, it } from 'vitest';
import {
  ANGELUS,
  REGINA_CAELI,
  angelusEmbed,
  hourLabel,
  isEasterTide,
} from '../../../src/modules/prayers/angelus.js';
import { embedLength } from '../../../src/shared/embed-pack.js';

describe('Angelus / Regina Caeli', () => {
  it('Regina Caeli do Domingo de Páscoa ao Pentecostes (2026: 5/4 a 24/5)', () => {
    expect(isEasterTide('2026-04-04')).toBe(false);
    expect(isEasterTide('2026-04-05')).toBe(true);
    expect(isEasterTide('2026-05-24')).toBe(true);
    expect(isEasterTide('2026-05-25')).toBe(false);
    expect(angelusEmbed('2026-04-05', '12:00').title).toBe('Regina Caeli');
    expect(angelusEmbed('2026-10-16', '12:00').title).toBe('Angelus');
  });

  it('formata a hora e a data reais da ocorrência', () => {
    expect(hourLabel('00:00')).toBe('00h');
    expect(hourLabel('06:00')).toBe('6h');
    expect(hourLabel('18:30')).toBe('18h30');
    expect(angelusEmbed('2026-10-16', '06:00').description).toBe(
      '🔔 6h · sexta-feira, 16 de outubro de 2026',
    );
  });

  it('latim e português lado a lado, Ave Maria abreviada, dentro dos limites do Discord', () => {
    for (const p of [ANGELUS, REGINA_CAELI]) {
      for (const v of [p.latin, p.portuguese, p.latinPrayer, p.portuguesePrayer])
        expect(v.length).toBeLessThanOrEqual(1024);
    }
    expect(ANGELUS.latin.split('*Ave Maria…*')).toHaveLength(4);
    expect(ANGELUS.portuguese.split('*Ave Maria…*')).toHaveLength(4);
    const e = angelusEmbed('2026-10-16', '12:00');
    expect(e.fields!.map((f) => [f.name, f.inline ?? false])).toEqual([
      ['Latim', true],
      ['Português', true],
      ['Oremus', false],
      ['Oremos', false],
    ]);
    expect(embedLength(e)).toBeLessThan(6000);
  });
});
