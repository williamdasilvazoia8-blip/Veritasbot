import { describe, expect, it } from 'vitest';
import { importMatosSoares } from '../../../src/modules/bible/import/matos-soares.js';
import { BOOKS } from '../../../src/modules/bible/domain/books.js';

/** Fonte sintética no formato do biblia.json (Dancrf/biblia-db), 2 versículos por capítulo. */
function syntheticSource(mutate?: (books: SourceBook[]) => void): string {
  const books: SourceBook[] = BOOKS.map((b) => ({
    livro: b.matosSoares.sourceName,
    capitulos: Array.from({ length: b.matosSoares.chapters }, (_, i) => ({
      capitulo: i + 1,
      versiculos: [
        { numero: 1, texto: `[SINTÉTICO ${b.id} ${i + 1},1]` },
        { numero: 2, texto: `[SINTÉTICO ${b.id} ${i + 1},2]` },
      ],
    })),
  }));
  mutate?.(books);
  return JSON.stringify(books);
}
type SourceBook = {
  livro: string;
  capitulos: Array<{ capitulo: number; versiculos: Array<{ numero: number; texto: string }> }>;
};

describe('importMatosSoares', () => {
  it('importa os 73 livros e calcula checksum', () => {
    const r = importMatosSoares(syntheticSource());
    expect(r.summary.books).toBe(73);
    expect(r.summary.chapters).toBe(BOOKS.reduce((n, b) => n + b.matosSoares.chapters, 0));
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.anomalies).toEqual([]);
  });

  it('registra lacunas e duplicatas sem alterar nem suprir texto', () => {
    const r = importMatosSoares(
      syntheticSource((books) => {
        const gen = books[0]!.capitulos[14]!;
        gen.versiculos = [
          { numero: 1, texto: 'a' },
          { numero: 3, texto: 'c' },
        ];
        const jn = books.find((b) => b.livro === 'Evangelho segundo S. João')!.capitulos[0]!;
        jn.versiculos = [
          { numero: 1, texto: 'x' },
          { numero: 1, texto: 'x' },
          { numero: 2, texto: 'y' },
        ];
        const os = books.find((b) => b.livro === 'Oseias')!.capitulos[10]!;
        os.versiculos = [
          { numero: 1, texto: 'deslocado' },
          { numero: 1, texto: 'certo' },
          { numero: 2, texto: 'z' },
        ];
      }),
    );
    expect(r.summary.anomaliesByKind).toEqual({
      gap: 1,
      'duplicate-identical-dropped': 1,
      'duplicate-number': 1,
    });
    const gen15 = r.verses.filter((v) => v.bookId === 'GEN' && v.chapter === 15);
    expect(gen15.map((v) => v.verse)).toEqual([1, 3]);
    expect(
      r.verses.filter((v) => v.bookId === 'HOS' && v.chapter === 11 && v.verse === 1).map((v) => v.text),
    ).toEqual(['deslocado', 'certo']);
  });

  it('falha com livro desconhecido ou contagem de capítulos divergente', () => {
    expect(() => importMatosSoares(syntheticSource((b) => (b[0]!.livro = 'Livro Estranho')))).toThrow(
      /sem correspondência/,
    );
    expect(() => importMatosSoares(syntheticSource((b) => b[0]!.capitulos.pop()))).toThrow(/capítulos/);
    expect(() => importMatosSoares(syntheticSource((b) => b.pop()))).toThrow();
  });

  it('rejeita texto vazio', () => {
    expect(() =>
      importMatosSoares(syntheticSource((b) => (b[0]!.capitulos[0]!.versiculos[0]!.texto = '  '))),
    ).toThrow(/vazio/);
  });
});
