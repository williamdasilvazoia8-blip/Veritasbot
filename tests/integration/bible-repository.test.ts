import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb, resetDb, testPrisma } from '../helpers/db.js';
import { importMatosSoares } from '../../src/modules/bible/import/matos-soares.js';
import { loadEdition, saveEdition } from '../../src/modules/bible/persistence/bible-repository.js';
import { InMemoryBibleProvider } from '../../src/modules/bible/application/in-memory-corpus.js';
import { parseSingleReference } from '../../src/modules/bible/parsing/reference-parser.js';
import { BOOKS } from '../../src/modules/bible/domain/books.js';

const meta = {
  id: 'test-edition',
  name: 'Edição de teste',
  source: 'tests',
  sourceRevision: null,
  provenance: 'sintético',
  rightsStatus: 'synthetic',
  versificationScheme: 'vulgate-psalms' as const,
};

describeDb('Persistência da Bíblia (PostgreSQL)', () => {
  const prisma = testPrisma();
  beforeAll(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('grava e recarrega uma edição com relatório de anomalias', async () => {
    const source = BOOKS.map((b) => ({
      livro: b.matosSoares.sourceName,
      capitulos: Array.from({ length: b.matosSoares.chapters }, (_, i) => ({
        capitulo: i + 1,
        versiculos: [
          { numero: 1, texto: `[SINTÉTICO ${b.id} ${i + 1},1]` },
          { numero: 3, texto: `[SINTÉTICO ${b.id} ${i + 1},3]` },
        ],
      })),
    }));
    const result = importMatosSoares(JSON.stringify(source));
    await saveEdition(prisma, meta, result);
    const loaded = await loadEdition(prisma, 'test-edition');
    expect(loaded?.verses).toHaveLength(result.verses.length);
    const provider = new InMemoryBibleProvider(loaded!.edition, loaded!.verses);
    const r = await provider.getPassage(parseSingleReference('Jo 3,1-3')!);
    expect(r.ok && r.passage.missing).toEqual([{ chapter: 3, verse: 2 }]);
    const edition = await prisma.bibleEdition.findUniqueOrThrow({ where: { id: 'test-edition' } });
    expect(
      (edition.anomalyReport as { summary: { anomaliesByKind: Record<string, number> } }).summary
        .anomaliesByKind.gap,
    ).toBeGreaterThan(0);
  });
});

/**
 * Teste OPCIONAL contra o arquivo real (Dancrf/biblia-db). Roda só com
 * BIBLE_SOURCE_PATH apontando para o biblia.json baixado pelo operador.
 */
const realPath = process.env.BIBLE_SOURCE_PATH;
(realPath ? describeDb : describeDb.skip)('Corpus real Matos Soares (opcional)', () => {
  it('importa 73 livros e cita João 3,16 e Sl 22 (Vulgata) corretamente', async () => {
    const result = importMatosSoares(readFileSync(realPath!, 'utf8'));
    expect(result.summary.books).toBe(73);
    const provider = new InMemoryBibleProvider(
      { ...meta, id: 'real', name: 'real', shortName: 'real' },
      result.verses,
    );
    const jn = await provider.getPassage(parseSingleReference('João 3,16')!);
    expect(jn.ok && jn.passage.verses[0]!.text).toMatch(/^Porque Deus amou de tal modo o mundo/);
    const ps = await provider.getPassage(parseSingleReference('Sl 22,1')!);
    expect(ps.ok && ps.passage.verses[0]!.text).toContain('O Senhor me apascenta');
  });
});
