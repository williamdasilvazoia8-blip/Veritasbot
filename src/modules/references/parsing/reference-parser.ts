import { blankOutCode } from '../../bible/parsing/strip-code.js';
import { DOCUMENTS, type ReferenceDocumentId } from '../domain/types.js';

export interface DocumentReference {
  documentId: ReferenceDocumentId;
  start: number;
  end: number;
  /** Fim pedido quando o intervalo foi cortado a MAX_RANGE unidades. */
  requestedEnd: number;
  raw: string;
}

/** Máximo de parágrafos/cânones num intervalo (ex.: "CCC 1234-1238"). */
export const MAX_RANGE = 5;

/*
 * Convenção (pt): CIC/CCC = Catecismo da Igreja Católica; CDC = Código de Direito Canónico.
 * "Catecismo 1234", "CCC §1234", "CIC 27-30"; "CDC 1055", "cân. 1055", "cânon 1055", "can. 1055".
 * "can" sem ponto não conta (evita falsos positivos em inglês).
 */
const PATTERNS: Array<{ documentId: ReferenceDocumentId; re: RegExp }> = [
  {
    documentId: 'ccc',
    re: /(?<![\p{L}\p{N}])(?:ccc|cic|catecismo)\s*(?:n\.?º?\s*|§\s*)?(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?(?![\p{L}\p{N}])(?![:,.]\d)/giu,
  },
  {
    documentId: 'cic',
    re: /(?<![\p{L}\p{N}])(?:cdc|c[âa]non(?:e|es)?|c[âa]nones|cân\.?|can\.)\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?(?![\p{L}\p{N}])(?![:,.]\d)/giu,
  },
];

/**
 * Encontra referências ao Catecismo e ao Código numa mensagem comum. Ignora blocos de
 * código, números fora do documento e intervalos invertidos; intervalos longos são
 * cortados às primeiras MAX_RANGE unidades (requestedEnd guarda o pedido original).
 */
export function parseDocumentReferences(text: string, maxResults = 3): DocumentReference[] {
  const clean = blankOutCode(text);
  const found: Array<DocumentReference & { index: number }> = [];
  for (const { documentId, re } of PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const start = Number(m[1]);
      const requestedEnd = m[2] ? Number(m[2]) : start;
      const max = DOCUMENTS[documentId].maxNumber;
      if (start < 1 || requestedEnd < start || requestedEnd > max) continue;
      const end = Math.min(requestedEnd, start + MAX_RANGE - 1);
      found.push({ documentId, start, end, requestedEnd, raw: m[0], index: m.index });
    }
  }
  const unique = new Map<string, (typeof found)[number]>();
  for (const r of found.sort((a, b) => a.index - b.index)) {
    const key = `${r.documentId}:${r.start}-${r.end}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  return [...unique.values()].slice(0, maxResults).map(({ index: _index, ...r }) => r);
}
