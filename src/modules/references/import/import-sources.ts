import { createHash } from 'node:crypto';
import { DOCUMENTS, type ReferenceDocumentId, type ReferenceUnit } from '../domain/types.js';
import { assembleCcc, CCC_BASE_URL, CCC_INDEX_URL, cccPagesFromIndex, parseCccPage } from './ccc-vatican.js';
import { CIC_PDF_URL, extractCicFromPdf } from './cic-cep.js';

/** Lê bytes de um URL (ou de outra origem, ex.: ficheiros locais nos testes/CLI). */
export type ByteSource = (url: string) => Promise<Uint8Array>;

export interface ExtractedDocument {
  id: ReferenceDocumentId;
  sourceSha256: string;
  units: ReferenceUnit[];
  report: { corrections: unknown[]; warnings: string[]; pages?: number };
}

export class ExtractionError extends Error {
  override name = 'ExtractionError';
}

/** As páginas do vatican.va estão em ISO-8859-1 (algumas declaram windows-1252). */
const latin1 = new TextDecoder('windows-1252');

export async function extractCcc(
  read: ByteSource,
  opts: { delayMs?: number } = {},
): Promise<ExtractedDocument> {
  const hash = createHash('sha256');
  const index = await read(CCC_INDEX_URL);
  hash.update(index);
  const pages = cccPagesFromIndex(latin1.decode(index));
  if (pages.length < 20) throw new ExtractionError(`Índice do Catecismo inesperado: ${pages.length} páginas`);
  const parsed: ReferenceUnit[][] = [];
  for (const page of pages) {
    const url = new URL(page, CCC_BASE_URL).href;
    const bytes = await read(url);
    hash.update(bytes);
    parsed.push(parseCccPage(latin1.decode(bytes), url));
    // Cortesia com o servidor da Santa Sé.
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  const { units, corrections } = assembleCcc(parsed);
  validateComplete('ccc', units);
  return {
    id: 'ccc',
    sourceSha256: hash.digest('hex'),
    units,
    report: { corrections, warnings: [], pages: pages.length },
  };
}

export async function extractCic(read: ByteSource): Promise<ExtractedDocument> {
  const pdf = await read(CIC_PDF_URL);
  const sourceSha256 = createHash('sha256').update(pdf).digest('hex');
  const { units, warnings } = await extractCicFromPdf(pdf);
  validateComplete('cic', units);
  return { id: 'cic', sourceSha256, units, report: { corrections: [], warnings } };
}

/**
 * Só se grava um documento completo: 1..N, sem repetidos, sem textos vazios. Se a fonte
 * mudar de formato, a importação falha em vez de gravar um Catecismo/Código com buracos.
 */
export function validateComplete(id: ReferenceDocumentId, units: ReferenceUnit[]): void {
  const max = DOCUMENTS[id].maxNumber;
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const u of units) {
    if (seen.has(u.number)) problems.push(`repetido: ${u.number}`);
    seen.add(u.number);
    if (u.text.trim().length === 0) problems.push(`vazio: ${u.number}`);
  }
  const missing: number[] = [];
  for (let n = 1; n <= max; n++) if (!seen.has(n)) missing.push(n);
  if (missing.length) problems.push(`em falta (${missing.length}): ${missing.slice(0, 20).join(', ')}`);
  const extra = units.filter((u) => u.number < 1 || u.number > max).map((u) => u.number);
  if (extra.length) problems.push(`fora do intervalo: ${extra.slice(0, 20).join(', ')}`);
  if (problems.length)
    throw new ExtractionError(
      `${DOCUMENTS[id].name}: extração incompleta — ${problems.slice(0, 10).join('; ')}`,
    );
}

/** Leitor HTTP com timeout e limite de tamanho. */
export function httpByteSource(
  opts: { timeoutMs?: number; maxBytes?: number; fetch?: typeof fetch } = {},
): ByteSource {
  const fetchFn = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? 20_000_000;
  return async (url) => {
    const res = await fetchFn(url, {
      headers: {
        'user-agent': 'VeritasBot (Discord; +https://github.com/williamdasilvazoia8-blip/veritasbot)',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) throw new ExtractionError(`HTTP ${res.status} em ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new ExtractionError(`Resposta grande demais em ${url}`);
    return buf;
  };
}
