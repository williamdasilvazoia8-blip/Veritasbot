import type { Prisma, PrismaClient } from '@prisma/client';
import type { BibleEditionInfo, BibleVerseRecord } from '../domain/types.js';
import type { ImportResult } from '../import/matos-soares.js';

export interface EditionMetadata {
  id: string;
  name: string;
  source: string;
  sourceRevision: string | null;
  provenance: string;
  rightsStatus: string;
  versificationScheme: BibleEditionInfo['versificationScheme'];
}

export async function saveEdition(
  prisma: PrismaClient,
  meta: EditionMetadata,
  result: ImportResult,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.bibleEdition.deleteMany({ where: { id: meta.id } });
      await tx.bibleEdition.create({
        data: {
          ...meta,
          sourceSha256: result.sha256,
          verseCount: result.verses.length,
          anomalyReport: {
            summary: result.summary,
            anomalies: result.anomalies,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const BATCH = 2000;
      for (let i = 0; i < result.verses.length; i += BATCH) {
        await tx.bibleVerse.createMany({
          data: result.verses.slice(i, i + BATCH).map((v) => ({ ...v, editionId: meta.id })),
        });
      }
    },
    { timeout: 120_000 },
  );
}

export async function loadEdition(
  prisma: PrismaClient,
  editionId: string,
): Promise<{ edition: BibleEditionInfo; verses: BibleVerseRecord[] } | null> {
  const edition = await prisma.bibleEdition.findUnique({ where: { id: editionId } });
  if (!edition) return null;
  const verses = await prisma.bibleVerse.findMany({
    where: { editionId },
    select: { bookId: true, chapter: true, verse: true, seq: true, text: true },
    orderBy: [{ bookId: 'asc' }, { chapter: 'asc' }, { seq: 'asc' }],
  });
  return {
    edition: {
      id: edition.id,
      name: edition.name,
      shortName: 'Matos Soares',
      source: edition.source,
      sourceRevision: edition.sourceRevision,
      rightsStatus: edition.rightsStatus,
      versificationScheme:
        edition.versificationScheme === 'hebrew-psalms' ? 'hebrew-psalms' : 'vulgate-psalms',
    },
    verses,
  };
}
