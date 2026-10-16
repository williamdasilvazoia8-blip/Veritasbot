import type { BibleVerseRecord } from '../domain/types.js';
import { normalizeForSearch } from '../../../shared/text-normalize.js';

export interface QuotationMatcherOptions {
  /** Tamanho do n-grama de palavras usado no índice. */
  shingleSize?: number;
  /** n-gramas presentes em mais versículos que isto são ignorados (expressões comuns). */
  maxPostings?: number;
}

export interface QuotationMatch {
  verse: BibleVerseRecord;
  /** Fração dos n-gramas da mensagem encontrados no versículo (0–1). */
  coverage: number;
  /** Fração dos n-gramas do versículo cobertos pela mensagem (0–1). */
  verseCoverage: number;
  matchedWords: number;
}

/**
 * Identificação de citações por correspondência exata de n-gramas normalizados
 * (sem acento/pontuação). Determinístico; nunca gera texto. Só retorna um
 * resultado quando há um vencedor claro acima dos limiares.
 */
export class QuotationMatcher {
  private readonly index = new Map<string, number[]>();
  private readonly shingleSize: number;
  private readonly verseShingleCount: number[] = [];

  constructor(
    private readonly verses: readonly BibleVerseRecord[],
    opts: QuotationMatcherOptions = {},
  ) {
    this.shingleSize = opts.shingleSize ?? 5;
    const maxPostings = opts.maxPostings ?? 8;
    verses.forEach((v, i) => {
      const sh = new Set(shingles(normalizeForSearch(v.text).split(' '), this.shingleSize));
      this.verseShingleCount[i] = sh.size;
      for (const s of sh) {
        const list = this.index.get(s);
        if (list) list.push(i);
        else this.index.set(s, [i]);
      }
    });
    for (const [k, list] of this.index) if (list.length > maxPostings) this.index.delete(k);
  }

  match(text: string, minWords: number, minCoverage = 0.85): QuotationMatch | null {
    const words = normalizeForSearch(text).split(' ').filter(Boolean);
    if (words.length < Math.max(minWords, this.shingleSize)) return null;
    const own = [...new Set(shingles(words, this.shingleSize))];
    const counts = new Map<number, number>();
    for (const s of own) for (const i of this.index.get(s) ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    if (!best) return null;
    const [idx, hits] = best;
    const coverage = hits / own.length;
    if (coverage < minCoverage) return null;
    // Ambíguo: outro versículo com contagem igual (texto repetido na Bíblia) → não responder.
    const second = ranked[1];
    if (second && second[1] === hits) return null;
    return {
      verse: this.verses[idx]!,
      coverage,
      verseCoverage: hits / Math.max(1, this.verseShingleCount[idx] ?? 1),
      matchedWords: hits + this.shingleSize - 1,
    };
  }
}

function shingles(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}
