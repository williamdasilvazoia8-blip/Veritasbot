import type { BibleEditionInfo, BibleReference, BibleVerseRecord } from '../domain/types.js';

export type PassageError =
  | { kind: 'edition-unavailable' }
  | { kind: 'unknown-book'; bookId: string }
  | { kind: 'chapter-out-of-range'; bookId: string; chapter: number; maxChapter: number }
  | { kind: 'verse-out-of-range'; bookId: string; chapter: number; verse: number; maxVerse: number }
  | { kind: 'no-verses-in-source'; bookId: string; chapter: number }
  | { kind: 'too-long'; verseCount: number; limit: number };

export interface Passage {
  reference: BibleReference;
  verses: BibleVerseRecord[];
  /** Versículos dentro do intervalo pedido que não constam na fonte digital (lacunas). */
  missing: Array<{ chapter: number; verse: number }>;
  edition: BibleEditionInfo;
}

export type PassageResult = { ok: true; passage: Passage } | { ok: false; error: PassageError };

export interface SearchHit {
  verse: BibleVerseRecord;
}

export interface BookInfo {
  bookId: string;
  chapters: number;
  versesPerChapter: number[];
}

export interface BibleProvider {
  readonly edition: BibleEditionInfo | null;
  getPassage(ref: BibleReference, opts?: { maxVerses?: number }): Promise<PassageResult>;
  searchText(query: string, limit: number): Promise<SearchHit[]>;
  getBook(bookId: string): Promise<BookInfo | null>;
  getRandomVerse(random?: () => number): Promise<BibleVerseRecord | null>;
  /** Todos os versículos (para indexação de citações). */
  allVerses(): readonly BibleVerseRecord[];
}
