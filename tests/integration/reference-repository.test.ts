import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb, resetDb, testPrisma } from '../helpers/db.js';
import {
  loadDocuments,
  saveDocument,
} from '../../src/modules/references/persistence/reference-repository.js';
import { ReferenceLibrary } from '../../src/modules/references/application/reference-library.js';

describeDb('Persistência do Catecismo/Código (PostgreSQL)', () => {
  const prisma = testPrisma();
  beforeAll(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('grava, substitui por inteiro ao reimportar e recarrega por ordem', async () => {
    const units = (texts: string[]) =>
      texts.map((text, i) => ({
        documentId: 'cic' as const,
        number: i + 1,
        text,
        context: 'Livro I',
        sourceUrl: null,
      }));
    await saveDocument(prisma, {
      id: 'cic',
      sourceSha256: 'a',
      rightsStatus: 'synthetic',
      units: units(['um', 'dois', 'três']),
      report: {},
    });
    await saveDocument(prisma, {
      id: 'cic',
      sourceSha256: 'b',
      rightsStatus: 'synthetic',
      units: units(['uno', 'duo']),
      report: { warnings: [] },
    });

    const docs = await loadDocuments(prisma);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.units.map((u) => u.text)).toEqual(['uno', 'duo']);
    const lib = new ReferenceLibrary(docs);
    expect(lib.get('cic', 2)).toMatchObject({ ok: true, units: [{ number: 2, context: 'Livro I' }] });
    expect(await prisma.referenceDocument.findUnique({ where: { id: 'cic' } })).toMatchObject({
      sourceSha256: 'b',
      unitCount: 2,
    });
  });
});
