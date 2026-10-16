import { normalizeForSearch } from '../../../shared/text-normalize.js';
import { DOCUMENTS, type ReferenceDocumentId, type ReferenceUnit } from '../domain/types.js';

export interface LoadedDocument {
  id: ReferenceDocumentId;
  edition: string;
  importedAt: Date;
  units: ReferenceUnit[];
}

export type LookupResult =
  | { ok: true; units: ReferenceUnit[]; missing: number[] }
  | { ok: false; error: 'not-imported' | 'out-of-range' | 'not-found' };

export interface SearchHit {
  unit: ReferenceUnit;
  snippet: string;
}

/**
 * Catecismo e Código em memória (≈ 5 MB). Só devolve texto importado: números sem texto
 * na fonte são reportados como em falta, nunca preenchidos.
 */
export class ReferenceLibrary {
  private readonly docs = new Map<
    ReferenceDocumentId,
    { doc: LoadedDocument; byNumber: Map<number, ReferenceUnit>; folded: string[] }
  >();

  constructor(documents: LoadedDocument[] = []) {
    for (const doc of documents) this.add(doc);
  }

  add(doc: LoadedDocument): void {
    this.docs.set(doc.id, {
      doc,
      byNumber: new Map(doc.units.map((u) => [u.number, u])),
      folded: doc.units.map((u) => normalizeForSearch(u.text)),
    });
  }

  has(id: ReferenceDocumentId): boolean {
    return this.docs.has(id);
  }

  info(id: ReferenceDocumentId): LoadedDocument | null {
    return this.docs.get(id)?.doc ?? null;
  }

  get(id: ReferenceDocumentId, start: number, end = start): LookupResult {
    const entry = this.docs.get(id);
    if (!entry) return { ok: false, error: 'not-imported' };
    if (start < 1 || end < start || end > DOCUMENTS[id].maxNumber)
      return { ok: false, error: 'out-of-range' };
    const units: ReferenceUnit[] = [];
    const missing: number[] = [];
    for (let n = start; n <= end; n++) {
      const u = entry.byNumber.get(n);
      if (u) units.push(u);
      else missing.push(n);
    }
    return units.length > 0 ? { ok: true, units, missing } : { ok: false, error: 'not-found' };
  }

  /** Todas as palavras (sem acentos/maiúsculas) têm de aparecer no parágrafo/cânon. */
  search(id: ReferenceDocumentId, query: string, limit = 10): SearchHit[] {
    const entry = this.docs.get(id);
    const words = normalizeForSearch(query)
      .split(' ')
      .filter((w) => w.length > 0);
    if (!entry || words.length === 0) return [];
    const hits: SearchHit[] = [];
    entry.folded.forEach((text, i) => {
      if (hits.length >= limit || !words.every((w) => text.includes(w))) return;
      const unit = entry.doc.units[i]!;
      hits.push({ unit, snippet: snippet(text, unit.text, words[0]!) });
    });
    return hits;
  }
}

/** Trecho de ~200 caracteres à volta da 1.ª ocorrência (posição aproximada no original). */
function snippet(folded: string, original: string, word: string): string {
  const ratio = original.length / Math.max(1, folded.length);
  const at = Math.floor(Math.max(0, folded.indexOf(word)) * ratio);
  const from = Math.max(0, at - 80);
  const flat = original.replace(/\s+/g, ' ');
  const part = flat.slice(from, from + 200).trim();
  return `${from > 0 ? '…' : ''}${part}${from + 200 < flat.length ? '…' : ''}`;
}
