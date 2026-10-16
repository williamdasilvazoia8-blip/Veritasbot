import { getBook } from '../domain/books.js';
import type { BibleEditionInfo, BibleReference, BibleVerseRecord } from '../domain/types.js';
import { normalizeForSearch } from '../../../shared/text-normalize.js';
import type { BibleProvider, BookInfo, Passage, PassageResult, SearchHit } from './bible-provider.js';

/**
 * Corpus completo em memória (~35 mil versículos), carregado do PostgreSQL na
 * inicialização. Consultas são determinísticas e sem rede.
 */
export class InMemoryBibleProvider implements BibleProvider {
  private readonly chapters = new Map<string, BibleVerseRecord[][]>();
  private readonly normalized: string[];

  constructor(
    readonly edition: BibleEditionInfo | null,
    private readonly verses: readonly BibleVerseRecord[],
  ) {
    const sorted = [...verses].sort(
      (a, b) =>
        (getBook(a.bookId)?.order ?? 0) - (getBook(b.bookId)?.order ?? 0) ||
        a.chapter - b.chapter ||
        a.seq - b.seq,
    );
    this.verses = sorted;
    for (const v of sorted) {
      let book = this.chapters.get(v.bookId);
      if (!book) this.chapters.set(v.bookId, (book = []));
      (book[v.chapter - 1] ??= []).push(v);
    }
    this.normalized = sorted.map((v) => normalizeForSearch(v.text));
  }

  static empty(): InMemoryBibleProvider {
    return new InMemoryBibleProvider(null, []);
  }

  allVerses(): readonly BibleVerseRecord[] {
    return this.verses;
  }

  async getBook(bookId: string): Promise<BookInfo | null> {
    const chapters = this.chapters.get(bookId);
    if (!chapters) return null;
    return {
      bookId,
      chapters: chapters.length,
      versesPerChapter: chapters.map((c) => maxVerse(c ?? [])),
    };
  }

  async getPassage(ref: BibleReference, opts: { maxVerses?: number } = {}): Promise<PassageResult> {
    if (!this.edition) return { ok: false, error: { kind: 'edition-unavailable' } };
    const book = this.chapters.get(ref.bookId);
    if (!book || !getBook(ref.bookId))
      return { ok: false, error: { kind: 'unknown-book', bookId: ref.bookId } };

    const chapterEnd = ref.chapterEnd ?? ref.chapter;
    for (const c of [ref.chapter, chapterEnd]) {
      if (c < 1 || c > book.length) {
        return {
          ok: false,
          error: { kind: 'chapter-out-of-range', bookId: ref.bookId, chapter: c, maxChapter: book.length },
        };
      }
    }

    const startVerse = ref.verseStart ?? 1;
    const firstChapter = book[ref.chapter - 1] ?? [];
    const lastChapter = book[chapterEnd - 1] ?? [];
    if (firstChapter.length === 0)
      return { ok: false, error: { kind: 'no-verses-in-source', bookId: ref.bookId, chapter: ref.chapter } };
    const endVerse = ref.verseStart === undefined ? maxVerse(lastChapter) : (ref.verseEnd ?? startVerse);

    if (startVerse > maxVerse(firstChapter)) {
      return {
        ok: false,
        error: {
          kind: 'verse-out-of-range',
          bookId: ref.bookId,
          chapter: ref.chapter,
          verse: startVerse,
          maxVerse: maxVerse(firstChapter),
        },
      };
    }
    if (endVerse > maxVerse(lastChapter)) {
      return {
        ok: false,
        error: {
          kind: 'verse-out-of-range',
          bookId: ref.bookId,
          chapter: chapterEnd,
          verse: endVerse,
          maxVerse: maxVerse(lastChapter),
        },
      };
    }

    const selected: BibleVerseRecord[] = [];
    const missing: Passage['missing'] = [];
    for (let c = ref.chapter; c <= chapterEnd; c++) {
      const records = book[c - 1] ?? [];
      const from = c === ref.chapter ? startVerse : 1;
      const to = c === chapterEnd ? endVerse : maxVerse(records);
      for (let v = from; v <= to; v++) {
        const found = records.filter((r) => r.verse === v);
        if (found.length === 0) missing.push({ chapter: c, verse: v });
        selected.push(...found);
      }
    }
    if (opts.maxVerses !== undefined && selected.length > opts.maxVerses) {
      return { ok: false, error: { kind: 'too-long', verseCount: selected.length, limit: opts.maxVerses } };
    }
    if (selected.length === 0)
      return { ok: false, error: { kind: 'no-verses-in-source', bookId: ref.bookId, chapter: ref.chapter } };
    return { ok: true, passage: { reference: ref, verses: selected, missing, edition: this.edition } };
  }

  async searchText(query: string, limit: number): Promise<SearchHit[]> {
    const q = normalizeForSearch(query);
    if (q.length < 3 || !this.edition) return [];
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.verses.length && hits.length < limit; i++) {
      if (` ${this.normalized[i]} `.includes(` ${q} `)) hits.push({ verse: this.verses[i]! });
    }
    return hits;
  }

  async getRandomVerse(random: () => number = Math.random): Promise<BibleVerseRecord | null> {
    if (!this.edition || this.verses.length === 0) return null;
    return this.verses[Math.floor(random() * this.verses.length)] ?? null;
  }
}

function maxVerse(records: readonly BibleVerseRecord[]): number {
  return records.reduce((m, r) => Math.max(m, r.verse), 0);
}
