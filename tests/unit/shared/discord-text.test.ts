import { describe, expect, it } from 'vitest';
import { escapeDiscord, splitText, truncate } from '../../../src/shared/discord-text.js';
import { parseBrDate } from '../../../src/shared/dates.js';

describe('escapeDiscord', () => {
  it('neutraliza menções e markdown', () => {
    expect(escapeDiscord('@everyone **oi**')).toBe('@​everyone \\*\\*oi\\*\\*');
    expect(escapeDiscord('<@123456789012345678>')).toBe('<​@123456789012345678>');
  });
  it('não quebra hífens dentro de palavras', () => {
    expect(escapeDiscord('Conduz-me junto das águas')).toBe('Conduz-me junto das águas');
    expect(escapeDiscord('- item')).toBe('\\- item');
  });
});

describe('splitText e truncate', () => {
  it('divide sem ultrapassar o limite e sem cortar palavras', () => {
    const text = 'palavra '.repeat(1000);
    const parts = splitText(text, 500);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join(' ').split(/\s+/).filter(Boolean)).toHaveLength(1000);
  });
  it('trunca com reticências', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('parseBrDate', () => {
  it('valida datas reais', () => {
    expect(parseBrDate('08/12/2026')).toBe('2026-12-08');
    expect(parseBrDate('31/02/2026')).toBeNull();
  });
});
