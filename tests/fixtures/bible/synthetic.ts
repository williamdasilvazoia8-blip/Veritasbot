import type { BibleEditionInfo, BibleVerseRecord } from '../../../src/modules/bible/domain/types.js';
import { InMemoryBibleProvider } from '../../../src/modules/bible/application/in-memory-corpus.js';

/**
 * Corpus SINTÉTICO para testes. Nenhum texto aqui é Escritura: cada versículo é
 * um marcador "[SINTÉTICO livro cap,ver]". Nunca usar fora dos testes.
 */
export const SYNTHETIC_EDITION: BibleEditionInfo = {
  id: 'synthetic-test',
  name: 'Edição sintética de teste',
  shortName: 'Sintética',
  source: 'tests/fixtures',
  sourceRevision: null,
  rightsStatus: 'synthetic',
  versificationScheme: 'vulgate-psalms',
  synthetic: true,
};

const CHAPTERS: Record<string, number[]> = {
  // livro: versículos por capítulo (índice = capítulo - 1)
  GEN: [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21],
  JOB: [22],
  PSA: Array.from({ length: 30 }, (_, i) => (i === 21 ? 6 : 10)),
  MAT: Array.from({ length: 16 }, (_, i) => (i === 15 ? 28 : 20)),
  JHN: [51, 25, 36, 54],
  ROM: [32, 29, 31, 25, 21, 23, 25, 39],
  '1CO': Array.from({ length: 13 }, (_, i) => (i === 12 ? 13 : 20)),
  '1JN': [10, 29, 24, 21],
  REV: Array.from({ length: 21 }, (_, i) => (i === 20 ? 27 : 20)),
  HOS: [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12],
};

/** Gênesis 15,4 é omitido de propósito para testar lacunas da fonte. */
const MISSING = new Set(['GEN.15.4']);

/** Frases distintivas para testar a identificação de citações. */
export const DISTINCTIVE: Record<string, string> = {
  'JHN.3.16': 'frase sintetica distintiva sobre amor imenso que atravessa montanhas azuis e rios dourados',
  'ROM.8.28': 'outra frase sintetica sobre todas as coisas cooperando em favor dos que perseveram firmes',
};

export function syntheticVerses(): BibleVerseRecord[] {
  const out: BibleVerseRecord[] = [];
  for (const [bookId, chapters] of Object.entries(CHAPTERS)) {
    chapters.forEach((count, ci) => {
      let seq = 0;
      for (let v = 1; v <= count; v++) {
        const key = `${bookId}.${ci + 1}.${v}`;
        if (MISSING.has(key)) continue;
        out.push({
          bookId,
          chapter: ci + 1,
          verse: v,
          seq: ++seq,
          text: DISTINCTIVE[key] ?? `[SINTÉTICO ${bookId} ${ci + 1},${v}]`,
        });
      }
    });
  }
  return out;
}

export function syntheticProvider(): InMemoryBibleProvider {
  return new InMemoryBibleProvider(SYNTHETIC_EDITION, syntheticVerses());
}
