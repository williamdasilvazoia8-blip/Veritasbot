import { describe, expect, it } from 'vitest';
import { QuotationMatcher } from '../../../src/modules/bible/search/quotation-matcher.js';
import {
  describeVulgatePsalm,
  hebrewToVulgate,
  vulgateToHebrew,
} from '../../../src/modules/bible/domain/psalms-versification.js';
import type { BibleVerseRecord } from '../../../src/modules/bible/domain/types.js';

const v = (bookId: string, verse: number, text: string): BibleVerseRecord => ({
  bookId,
  chapter: 1,
  verse,
  seq: verse,
  text,
});

describe('QuotationMatcher', () => {
  const verses = [
    v('AAA', 1, 'alfa beta gama delta epsilon zeta eta teta iota capa'),
    v('BBB', 1, 'um dois tres quatro cinco seis sete oito nove dez'),
    // texto repetido em dois lugares: ambíguo
    v('CCC', 1, 'repetido azul verde amarelo roxo laranja branco preto'),
    v('DDD', 1, 'repetido azul verde amarelo roxo laranja branco preto'),
  ];
  const m = new QuotationMatcher(verses, { shingleSize: 3 });

  it('encontra citação exata ignorando acentos e pontuação', () => {
    expect(m.match('Alfa, BETA! gáma delta épsilon zeta eta', 5)?.verse.bookId).toBe('AAA');
  });

  it('exige número mínimo de palavras', () => {
    expect(m.match('alfa beta gama', 5)).toBeNull();
  });

  it('não responde quando a cobertura é baixa', () => {
    expect(m.match('alfa beta gama e depois muitas outras palavras sem relação alguma aqui', 5)).toBeNull();
  });

  it('não responde quando há empate entre versículos', () => {
    expect(m.match('repetido azul verde amarelo roxo laranja', 5)).toBeNull();
  });
});

describe('versificação dos Salmos', () => {
  it.each([
    [23, 22],
    [51, 50],
    [8, 8],
    [148, 148],
    [146, 145],
  ])('hebraico %i → Vulgata %i', (h, vg) => {
    expect(hebrewToVulgate(h)).toBe(vg);
    expect(vulgateToHebrew(vg)).toBe(h);
  });

  it.each([9, 10, 114, 115, 116, 147])('hebraico %i não é 1:1', (h) => {
    expect(hebrewToVulgate(h)).toBeNull();
  });

  it('descreve salmos divididos', () => {
    expect(describeVulgatePsalm(9)).toContain('9–10');
    expect(describeVulgatePsalm(22)).toContain('Sl 23');
  });
});
