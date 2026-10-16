import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BOOKS } from '../domain/books.js';
import type { BibleVerseRecord } from '../domain/types.js';

/** Formato do arquivo `biblia.json` do repositório Dancrf/biblia-db (verificado em 2026-10-16). */
export const matosSoaresSourceSchema = z
  .array(
    z.object({
      livro: z.string().min(1),
      capitulos: z.array(
        z.object({
          capitulo: z.number().int().positive(),
          versiculos: z.array(z.object({ numero: z.number().int().positive(), texto: z.string() })),
        }),
      ),
    }),
  )
  .length(73);

export type AnomalyKind =
  'gap' | 'duplicate-identical-dropped' | 'duplicate-number' | 'non-monotonic' | 'chapter-renumbered';

export interface ImportAnomaly {
  kind: AnomalyKind;
  bookId: string;
  chapter: number;
  detail: string;
}

export interface ImportResult {
  verses: BibleVerseRecord[];
  anomalies: ImportAnomaly[];
  sha256: string;
  summary: { books: number; chapters: number; verses: number; anomaliesByKind: Record<string, number> };
}

/**
 * Converte o JSON de origem para registros canônicos. NÃO altera o texto além de
 * normalização Unicode NFC e remoção de espaços nas pontas; NÃO supre versículos
 * ausentes. Toda irregularidade de numeração é registrada no relatório.
 */
export function importMatosSoares(rawJson: string): ImportResult {
  const sha256 = createHash('sha256').update(rawJson).digest('hex');
  const parsed = matosSoaresSourceSchema.parse(JSON.parse(rawJson));
  const bySourceName = new Map(BOOKS.map((b) => [b.matosSoares.sourceName, b]));
  const seenBooks = new Set<string>();
  const verses: BibleVerseRecord[] = [];
  const anomalies: ImportAnomaly[] = [];
  let chapters = 0;

  for (const srcBook of parsed) {
    const book = bySourceName.get(srcBook.livro);
    if (!book) throw new Error(`Livro da fonte sem correspondência no catálogo: "${srcBook.livro}"`);
    if (seenBooks.has(book.id)) throw new Error(`Livro duplicado na fonte: ${book.id}`);
    seenBooks.add(book.id);
    if (srcBook.capitulos.length !== book.matosSoares.chapters) {
      throw new Error(
        `${book.id}: esperado ${book.matosSoares.chapters} capítulos, fonte tem ${srcBook.capitulos.length}`,
      );
    }

    srcBook.capitulos.forEach((cap, ci) => {
      const chapter = ci + 1;
      chapters++;
      if (cap.capitulo !== chapter) {
        anomalies.push({
          kind: 'chapter-renumbered',
          bookId: book.id,
          chapter,
          detail: `fonte indica capítulo ${cap.capitulo} na posição ${chapter}`,
        });
      }
      let seq = 0;
      let prev: { verse: number; text: string } | undefined;
      for (const v of cap.versiculos) {
        const text = v.texto.normalize('NFC').trim();
        if (text.length === 0) throw new Error(`${book.id} ${chapter}:${v.numero}: texto vazio`);
        if (prev && prev.verse === v.numero && prev.text === text) {
          anomalies.push({
            kind: 'duplicate-identical-dropped',
            bookId: book.id,
            chapter,
            detail: `v. ${v.numero} repetido com texto idêntico; mantido uma vez`,
          });
          continue;
        }
        const expected = prev ? prev.verse + 1 : 1;
        if (v.numero !== expected) {
          if (prev && v.numero === prev.verse) {
            anomalies.push({
              kind: 'duplicate-number',
              bookId: book.id,
              chapter,
              detail: `v. ${v.numero} aparece mais de uma vez com textos diferentes`,
            });
          } else if (v.numero > expected) {
            const missing = v.numero - expected === 1 ? `${expected}` : `${expected}–${v.numero - 1}`;
            anomalies.push({
              kind: 'gap',
              bookId: book.id,
              chapter,
              detail: `v. ${missing} ausente(s) na fonte`,
            });
          } else {
            anomalies.push({
              kind: 'non-monotonic',
              bookId: book.id,
              chapter,
              detail: `v. ${v.numero} após v. ${prev?.verse ?? 0}`,
            });
          }
        }
        verses.push({ bookId: book.id, chapter, verse: v.numero, seq: ++seq, text });
        prev = { verse: v.numero, text };
      }
    });
  }
  if (seenBooks.size !== 73) throw new Error(`Esperados 73 livros, encontrados ${seenBooks.size}`);

  const anomaliesByKind: Record<string, number> = {};
  for (const a of anomalies) anomaliesByKind[a.kind] = (anomaliesByKind[a.kind] ?? 0) + 1;
  return {
    verses,
    anomalies,
    sha256,
    summary: { books: seenBooks.size, chapters, verses: verses.length, anomaliesByKind },
  };
}
