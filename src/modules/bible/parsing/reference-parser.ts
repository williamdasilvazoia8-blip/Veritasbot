import { BOOKS, type BookDefinition } from '../domain/books.js';
import { type BibleReference, referenceKey } from '../domain/types.js';
import { foldPreservingLength } from '../../../shared/text-normalize.js';
import { blankOutCode } from './strip-code.js';

export interface ParseOptions {
  /** Exige versículo (padrão true). A detecção automática nunca aceita só capítulo. */
  requireVerse?: boolean;
  /** Aplica regras conservadoras de mensagens comuns (aliases ambíguos exigem maiúscula). */
  strict?: boolean;
  /** Ignora trechos de código (padrão true). */
  ignoreCode?: boolean;
  maxResults?: number;
}

const ROMAN: Record<string, 1 | 2 | 3> = { i: 1, ii: 2, iii: 3 };

const plainAliases = new Map<string, BookDefinition>();
const numberedAliases = new Map<string, BookDefinition>();
const ambiguous = new Set<string>();

for (const book of BOOKS) {
  for (const alias of book.aliases) {
    if (book.ordinal) numberedAliases.set(`${book.ordinal}|${alias}`, book);
    else plainAliases.set(alias, book);
  }
  for (const a of book.ambiguousLowercase ?? []) ambiguous.add(a);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const byLengthDesc = (a: string, b: string) => b.length - a.length;
const numberedBases = [...new Set([...numberedAliases.keys()].map((k) => k.split('|')[1]!))].sort(
  byLengthDesc,
);
const plainList = [...plainAliases.keys()].sort(byLengthDesc);

const VERSE = String.raw`(\d{1,3})[a-f]?`;
const PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])` +
    String.raw`(?:(?:([123])\s*[ºª°]?\.?\s*|(iii|ii|i)\s+)(${numberedBases.map(escapeRe).join('|')})|(${plainList.map(escapeRe).join('|')}))` +
    String.raw`(?!\p{L})\.?\s*(\d{1,3})` +
    String.raw`(?:\s*[:,]\s*${VERSE}(?:\s*[-–—]\s*${VERSE}(?:\s*[:,]\s*${VERSE})?)?)?` +
    String.raw`(?![\p{N}\p{L}])`,
  'gu',
);

/**
 * Extrai referências bíblicas de texto livre de forma determinística.
 * Não usa heurísticas probabilísticas: só reconhece livro conhecido + capítulo (+ versículos).
 */
export function parseReferences(text: string, options: ParseOptions = {}): BibleReference[] {
  const { requireVerse = true, strict = false, ignoreCode = true, maxResults = 10 } = options;
  const source = ignoreCode ? blankOutCode(text) : text;
  const folded = foldPreservingLength(source);
  const results: BibleReference[] = [];
  const seen = new Set<string>();

  for (const m of folded.matchAll(PATTERN)) {
    if (results.length >= maxResults) break;
    const [full, numDigit, numRoman, numberedBase, plainAlias, chap, v1, v2, v3] = m;
    const index = m.index;

    let book: BookDefinition | undefined;
    let aliasText: string;
    if (numberedBase !== undefined) {
      const ordinal = numDigit ? Number(numDigit) : ROMAN[numRoman ?? ''];
      book = numberedAliases.get(`${ordinal}|${numberedBase}`);
      aliasText = numberedBase;
    } else {
      book = plainAliases.get(plainAlias ?? '');
      aliasText = plainAlias ?? '';
    }
    if (!book) continue;

    const originalAlias =
      source
        .slice(index, index + full.length)
        .match(/\p{L}[\p{L}\s]*/u)?.[0]
        .trim() ?? '';
    // "Jó" (Job) x "Jo" (João): idênticos sem acento, decide pelo original.
    if (book.id === 'JHN' && /^j[óÓ]$/iu.test(originalAlias)) book = BOOKS.find((b) => b.id === 'JOB');
    if (!book) continue;

    if (strict && ambiguous.has(aliasText) && !/^\p{Lu}/u.test(originalAlias)) continue;

    const chapter = Number(chap);
    if (chapter < 1) continue;
    if (v1 === undefined) {
      if (requireVerse) continue;
      const ref: BibleReference = {
        bookId: book.id,
        chapter,
        raw: text.slice(index, index + full.length),
        index,
      };
      pushUnique(ref);
      continue;
    }

    const verseStart = Number(v1);
    let chapterEnd: number | undefined;
    let verseEnd: number | undefined;
    if (v3 !== undefined) {
      chapterEnd = Number(v2);
      verseEnd = Number(v3);
    } else if (v2 !== undefined) {
      chapterEnd = chapter;
      verseEnd = Number(v2);
    }
    if (verseStart < 1) continue;
    if (chapterEnd !== undefined && verseEnd !== undefined) {
      if (chapterEnd < chapter || (chapterEnd === chapter && verseEnd < verseStart) || verseEnd < 1) continue;
    }
    const ref: BibleReference = {
      bookId: book.id,
      chapter,
      verseStart,
      ...(chapterEnd !== undefined ? { chapterEnd, verseEnd } : {}),
      raw: text.slice(index, index + full.length).trim(),
      index,
    };
    pushUnique(ref);
  }
  return results;

  function pushUnique(ref: BibleReference) {
    const key = referenceKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(ref);
  }
}

/** Interpreta exatamente uma referência (comandos manuais). Aceita capítulo inteiro. */
export function parseSingleReference(input: string): BibleReference | null {
  const refs = parseReferences(input, {
    requireVerse: false,
    strict: false,
    ignoreCode: false,
    maxResults: 1,
  });
  return refs[0] ?? null;
}

/** Procura um livro por nome/abreviação (autocomplete e /biblia livro). */
export function findBook(query: string): BookDefinition | undefined {
  const q = foldPreservingLength(query.trim()).replace(/\s+/g, ' ');
  const direct = BOOKS.find((b) => b.id.toLowerCase() === q || foldPreservingLength(b.name) === q);
  if (direct) return direct;
  const m = q.match(/^(?:([123])\s*[ºª°]?\.?\s*|(iii|ii|i)\s+)?(.+)$/u);
  if (!m) return undefined;
  const ordinal = m[1] ? Number(m[1]) : m[2] ? ROMAN[m[2]] : undefined;
  const base = m[3]!.replace(/\.$/, '');
  if (ordinal) return numberedAliases.get(`${ordinal}|${base}`);
  if (base === 'jo' && /ó/i.test(query)) return BOOKS.find((b) => b.id === 'JOB');
  return plainAliases.get(base);
}
