import { requireBook } from '../domain/books.js';
import type { BibleEditionInfo, BibleReference } from '../domain/types.js';
import { describeVulgatePsalm } from '../domain/psalms-versification.js';
import { DISCORD_LIMITS, escapeDiscord, splitText } from '../../../shared/discord-text.js';
import type { Passage, PassageError } from './bible-provider.js';

export interface FormattedPassage {
  title: string;
  pages: string[];
  footer: string;
  notes: string[];
}

/** "João 3,16-18", "Gênesis 1,1–2,3", "Salmos 22" (vírgula entre capítulo e versículo, uso lusófono). */
export function formatCitation(
  ref: Pick<BibleReference, 'bookId' | 'chapter' | 'verseStart' | 'chapterEnd' | 'verseEnd'>,
  abbreviated = false,
): string {
  const book = requireBook(ref.bookId);
  const name = abbreviated ? book.abbrev : book.name;
  if (ref.verseStart === undefined) return `${name} ${ref.chapter}`;
  let out = `${name} ${ref.chapter},${ref.verseStart}`;
  if (ref.verseEnd !== undefined) {
    if (ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter)
      out += `–${ref.chapterEnd},${ref.verseEnd}`;
    else if (ref.verseEnd !== ref.verseStart) out += `-${ref.verseEnd}`;
  }
  return out;
}

export function editionAttribution(e: BibleEditionInfo): string {
  if (e.synthetic) return '⚠️ TEXTO SINTÉTICO DE TESTE — não é texto bíblico autêntico';
  return `${e.name} · fonte digital: ${e.source}`;
}

export function formatPassage(
  passage: Passage,
  maxPageLength: number = DISCORD_LIMITS.embedDescription - 96,
): FormattedPassage {
  const crossChapter =
    passage.reference.chapterEnd !== undefined && passage.reference.chapterEnd !== passage.reference.chapter;
  const lines = passage.verses.map((v) => {
    const num = crossChapter ? `${v.chapter},${v.verse}` : `${v.verse}`;
    return `**${num}** ${escapeDiscord(v.text.trim())}`;
  });
  const notes: string[] = [];
  if (passage.missing.length > 0) {
    const list = passage.missing
      .map((m) => (crossChapter ? `${m.chapter},${m.verse}` : `${m.verse}`))
      .join(', ');
    notes.push(`Versículo(s) ${list} não consta(m) na fonte digital desta edição; nenhum texto foi suprido.`);
  }
  if (passage.reference.bookId === 'PSA' && passage.edition.versificationScheme === 'vulgate-psalms') {
    notes.push(describeVulgatePsalm(passage.reference.chapter));
  }
  return {
    title: formatCitation(passage.reference),
    pages: splitText(lines.join('\n'), maxPageLength),
    footer: editionAttribution(passage.edition),
    notes,
  };
}

export function describePassageError(error: PassageError): string {
  switch (error.kind) {
    case 'edition-unavailable':
      return 'O texto da Bíblia de Matos Soares ainda não foi importado neste bot. Um administrador precisa executar a importação (veja a documentação).';
    case 'unknown-book':
      return 'Livro não encontrado nesta edição.';
    case 'chapter-out-of-range':
      return `${requireBook(error.bookId).name} tem ${error.maxChapter} capítulo(s); o capítulo ${error.chapter} não existe.`;
    case 'verse-out-of-range':
      return `${requireBook(error.bookId).name} ${error.chapter} tem ${error.maxVerse} versículo(s) nesta edição; o versículo ${error.verse} não existe.`;
    case 'no-verses-in-source':
      return 'Os versículos pedidos não constam na fonte digital desta edição.';
    case 'too-long':
      return `Passagem longa demais (${error.verseCount} versículos; limite ${error.limit}). Peça um trecho menor.`;
  }
}
