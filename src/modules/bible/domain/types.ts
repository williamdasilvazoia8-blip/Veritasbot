export interface BibleReference {
  bookId: string;
  chapter: number;
  /** Ausente = capítulo inteiro (apenas em comandos manuais). */
  verseStart?: number;
  chapterEnd?: number;
  verseEnd?: number;
  /** Texto exatamente como apareceu na mensagem. */
  raw: string;
  index: number;
}

export interface BibleVerseRecord {
  bookId: string;
  chapter: number;
  verse: number;
  seq: number;
  text: string;
}

export interface BibleEditionInfo {
  id: string;
  name: string;
  shortName: string;
  source: string;
  sourceRevision: string | null;
  rightsStatus: string;
  versificationScheme: 'vulgate-psalms' | 'hebrew-psalms';
  /** true apenas para fixtures sintéticos de teste: nunca exibir como texto autêntico. */
  synthetic?: boolean;
}

export function referenceKey(
  ref: Pick<BibleReference, 'bookId' | 'chapter' | 'verseStart' | 'chapterEnd' | 'verseEnd'>,
): string {
  return `${ref.bookId}.${ref.chapter}.${ref.verseStart ?? ''}-${ref.chapterEnd ?? ''}.${ref.verseEnd ?? ''}`;
}
