import type { Prisma, PrismaClient } from '@prisma/client';
import { DOCUMENT_IDS, DOCUMENTS, type ReferenceDocumentId, type ReferenceUnit } from '../domain/types.js';
import type { LoadedDocument } from '../application/reference-library.js';

export interface DocumentImport {
  id: ReferenceDocumentId;
  sourceSha256: string;
  rightsStatus: string;
  units: ReferenceUnit[];
  report: unknown;
}

/** Substitui o documento inteiro numa transação (reimportar é idempotente). */
export async function saveDocument(prisma: PrismaClient, doc: DocumentImport): Promise<void> {
  const info = DOCUMENTS[doc.id];
  await prisma.$transaction(
    async (tx) => {
      await tx.referenceDocument.deleteMany({ where: { id: doc.id } });
      await tx.referenceDocument.create({
        data: {
          id: doc.id,
          name: info.name,
          edition: info.edition,
          source: info.sourceUrl,
          sourceSha256: doc.sourceSha256,
          rightsStatus: doc.rightsStatus,
          unitCount: doc.units.length,
          report: doc.report as Prisma.InputJsonValue,
        },
      });
      const BATCH = 1000;
      for (let i = 0; i < doc.units.length; i += BATCH) {
        await tx.referenceText.createMany({
          data: doc.units.slice(i, i + BATCH).map((u) => ({
            documentId: doc.id,
            number: u.number,
            text: u.text,
            context: u.context,
            sourceUrl: u.sourceUrl,
          })),
        });
      }
    },
    { timeout: 120_000 },
  );
}

export async function loadDocuments(prisma: PrismaClient): Promise<LoadedDocument[]> {
  const docs = await prisma.referenceDocument.findMany({ where: { id: { in: DOCUMENT_IDS } } });
  const out: LoadedDocument[] = [];
  for (const d of docs) {
    const id = d.id as ReferenceDocumentId;
    const rows = await prisma.referenceText.findMany({
      where: { documentId: id },
      orderBy: { number: 'asc' },
    });
    out.push({
      id,
      edition: d.edition,
      importedAt: d.importedAt,
      units: rows.map((r) => ({
        documentId: id,
        number: r.number,
        text: r.text,
        context: r.context,
        sourceUrl: r.sourceUrl,
      })),
    });
  }
  return out;
}
