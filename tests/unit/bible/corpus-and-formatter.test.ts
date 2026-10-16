import { describe, expect, it } from 'vitest';
import { syntheticProvider } from '../../fixtures/bible/synthetic.js';
import { parseSingleReference } from '../../../src/modules/bible/parsing/reference-parser.js';
import {
  describePassageError,
  formatCitation,
  formatPassage,
} from '../../../src/modules/bible/application/passage-formatter.js';
import { InMemoryBibleProvider } from '../../../src/modules/bible/application/in-memory-corpus.js';
import { BOOKS } from '../../../src/modules/bible/domain/books.js';

const p = syntheticProvider();
const ref = (s: string) => parseSingleReference(s)!;

describe('catálogo de livros', () => {
  it('tem os 73 livros católicos com IDs únicos', () => {
    expect(BOOKS).toHaveLength(73);
    expect(new Set(BOOKS.map((b) => b.id)).size).toBe(73);
    expect(
      BOOKS.filter((b) => b.deuterocanonical)
        .map((b) => b.id)
        .sort(),
    ).toEqual(['1MA', '2MA', 'BAR', 'JDT', 'SIR', 'TOB', 'WIS']);
  });
});

describe('InMemoryBibleProvider', () => {
  it('retorna o versículo pedido', async () => {
    const r = await p.getPassage(ref('João 3,16'));
    expect(r.ok && r.passage.verses.map((v) => v.verse)).toEqual([16]);
  });

  it('retorna intervalos, inclusive entre capítulos', async () => {
    const r = await p.getPassage(ref('Jo 3,35-4,2'));
    expect(r.ok && r.passage.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual([
      '3:35',
      '3:36',
      '4:1',
      '4:2',
    ]);
  });

  it('rejeita capítulo inexistente sem inventar texto', async () => {
    const r = await p.getPassage(ref('Jo 99,1'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(describePassageError(r.error)).toContain('não existe');
  });

  it('rejeita versículo além do último', async () => {
    const r = await p.getPassage(ref('Jo 3,37'));
    expect(r).toMatchObject({ ok: false, error: { kind: 'verse-out-of-range', maxVerse: 36 } });
  });

  it('informa lacunas da fonte em vez de suprir texto', async () => {
    const r = await p.getPassage(ref('Gn 15,3-5'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passage.verses.map((v) => v.verse)).toEqual([3, 5]);
    expect(r.passage.missing).toEqual([{ chapter: 15, verse: 4 }]);
    expect(formatPassage(r.passage).notes[0]).toContain('não consta');
  });

  it('respeita limite de versículos', async () => {
    const r = await p.getPassage(ref('Jo 1,1-40'), { maxVerses: 30 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'too-long', verseCount: 40 } });
  });

  it('sem edição importada, informa estado de configuração', async () => {
    const r = await InMemoryBibleProvider.empty().getPassage(ref('Jo 3,16'));
    expect(r).toEqual({ ok: false, error: { kind: 'edition-unavailable' } });
    expect(describePassageError({ kind: 'edition-unavailable' })).toContain('não foi importado');
  });

  it('busca textual ignora acentos e pontuação', async () => {
    const hits = await p.searchText('Frase SINTÉTICA distintiva', 5);
    expect(hits.map((h) => `${h.verse.bookId} ${h.verse.chapter}:${h.verse.verse}`)).toEqual(['JHN 3:16']);
  });

  it('versículo aleatório é determinístico com random injetado', async () => {
    const v = await p.getRandomVerse(() => 0);
    expect(v).not.toBeNull();
  });
});

describe('formatação', () => {
  it('usa vírgula lusófona na citação', () => {
    expect(formatCitation({ bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: 18, chapterEnd: 3 })).toBe(
      'João 3,16-18',
    );
    expect(formatCitation({ bookId: 'GEN', chapter: 1, verseStart: 1, chapterEnd: 2, verseEnd: 3 })).toBe(
      'Gênesis 1,1–2,3',
    );
  });

  it('rótulo de fixture sintético nunca se passa por texto autêntico', async () => {
    const r = await p.getPassage(ref('Jo 3,16'));
    if (!r.ok) throw new Error('esperava ok');
    const f = formatPassage(r.passage);
    expect(f.footer).toContain('SINTÉTICO');
    expect(f.footer).not.toContain('Matos Soares');
  });

  it('adiciona nota de numeração da Vulgata nos Salmos', async () => {
    const r = await p.getPassage(ref('Sl 22,1'));
    if (!r.ok) throw new Error('esperava ok');
    expect(formatPassage(r.passage).notes.join(' ')).toContain('Sl 23');
  });

  it('pagina passagens longas', async () => {
    const r = await p.getPassage(ref('Rm 8,1-39'));
    if (!r.ok) throw new Error('esperava ok');
    const f = formatPassage(r.passage, 200);
    expect(f.pages.length).toBeGreaterThan(1);
    expect(f.pages.every((pg) => pg.length <= 200)).toBe(true);
  });
});
