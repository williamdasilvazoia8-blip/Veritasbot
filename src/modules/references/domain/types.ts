/** Documentos de referência citáveis por número (além da Bíblia). */
export type ReferenceDocumentId = 'ccc' | 'cic';

/** Um parágrafo do Catecismo ou um cânon do Código, com o título de secção mais próximo. */
export interface ReferenceUnit {
  documentId: ReferenceDocumentId;
  number: number;
  text: string;
  /** Título/secção onde a unidade aparece (ex.: "Artigo 1 — Creio em Deus Pai"). */
  context: string | null;
  /** Página de origem (link para o texto oficial). */
  sourceUrl: string | null;
}

export interface ReferenceDocumentInfo {
  id: ReferenceDocumentId;
  name: string;
  unitLabel: string;
  edition: string;
  copyright: string;
  sourceUrl: string;
  maxNumber: number;
}

export const DOCUMENTS: Record<ReferenceDocumentId, ReferenceDocumentInfo> = {
  ccc: {
    id: 'ccc',
    name: 'Catecismo da Igreja Católica',
    unitLabel: '§',
    edition: 'Versão portuguesa publicada pela Santa Sé (vatican.va)',
    copyright: '© Libreria Editrice Vaticana',
    sourceUrl: 'https://www.vatican.va/archive/cathechism_po/index_new/prima-pagina-cic_po.html',
    maxNumber: 2865,
  },
  cic: {
    id: 'cic',
    name: 'Código de Direito Canónico',
    unitLabel: 'cân.',
    edition: 'Versão portuguesa atualizada (Conferência Episcopal Portuguesa, 2025)',
    copyright: '© Conferência Episcopal Portuguesa — versão portuguesa',
    sourceUrl: 'https://www.conferenciaepiscopal.pt/v1/wp-content/uploads/2026/04/CIC_SiteCEP.pdf',
    maxNumber: 1752,
  },
};

export const DOCUMENT_IDS = Object.keys(DOCUMENTS) as ReferenceDocumentId[];

/** "Catecismo, §1234" / "Código de Direito Canónico, cân. 1055-1057". */
export function formatUnitRange(id: ReferenceDocumentId, start: number, end = start): string {
  const d = DOCUMENTS[id];
  const range = end > start ? `${start}-${end}` : `${start}`;
  return id === 'ccc' ? `${d.name}, §${range}` : `${d.name}, cân. ${range}`;
}
