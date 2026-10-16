import { decodeHTML } from 'entities';
import type { ReferenceUnit } from '../domain/types.js';

/**
 * Extração do Catecismo da Igreja Católica (versão portuguesa publicada pela Santa Sé
 * em vatican.va). Cada página tem um intervalo de parágrafos; o parágrafo começa com o
 * número em negrito ("<b>11.</b>"), pode continuar em citações (<blockquote>) e as
 * notas de rodapé vêm depois de "<hr/> Notas" e são descartadas.
 */

export const CCC_BASE_URL = 'https://www.vatican.va/archive/cathechism_po/index_new/';
export const CCC_INDEX_URL = `${CCC_BASE_URL}prima-pagina-cic_po.html`;

/** Páginas de conteúdo listadas no índice (sem índices nem documentos papais). */
export function cccPagesFromIndex(indexHtml: string): string[] {
  const pages: string[] = [];
  for (const m of indexHtml.matchAll(/href="([^"#]+?_po\.html)/g)) {
    const href = m[1]!;
    if (href.startsWith('/') || href.includes('index') || href.includes('indice')) continue;
    if (!pages.includes(href)) pages.push(href);
  }
  return pages;
}

const BLOCK_SPLIT =
  /<\/?(?:p|blockquote|div|h[1-6]|table|tbody|thead|tr|td|th|center|ul|ol|li)\b[^>]*>|<br\s*\/?>/i;

function toText(raw: string): string {
  return decodeHTML(raw.replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove marcadores de nota de rodapé como "(12)" — as notas não são importadas. */
function stripFootnoteMarks(text: string): string {
  return text.replace(/\s?\(\d{1,3}\)/g, '').replace(/\s+([.,;:])/g, '$1');
}

export function parseCccPage(html: string, sourceUrl: string | null = null): ReferenceUnit[] {
  const bodyStart = html.search(/<body\b/i);
  let body = bodyStart >= 0 ? html.slice(bodyStart) : html;
  // As notas de rodapé vêm sempre depois do ÚLTIMO <hr> (algumas páginas têm um <hr> decorativo antes).
  const lastHr = body.toLowerCase().lastIndexOf('<hr');
  if (lastHr >= 0) body = body.slice(0, lastHr);

  const units: ReferenceUnit[] = [];
  let current: ReferenceUnit | null = null;
  let context: string | null = null;

  for (const raw of body.split(BLOCK_SPLIT)) {
    const text = toText(raw);
    if (!text) continue;
    // Início de parágrafo: bloco que começa com o número em negrito (a marcação varia:
    // "<b>33<i>. </i></b>", "<b>2865</b><i>. …", "<b>1065.</b>",
    // "<b>295</b> Acreditamos…", "&nbsp;<b>730.</b> …"). O 1.º trecho em negrito tem só o número.
    const leadBold = /^(?:\s|&nbsp;|<\/?(?:font|span|a)\b[^>]*>)*<b>([\s\S]*?)<\/b>/i.exec(raw);
    const boldNumber = leadBold ? /^(\d{1,4})\s*\.?$/.exec(toText(leadBold[1]!)) : null;
    const numbered = boldNumber ? /^(\d{1,4})\s*\.?\s*/.exec(text) : null;
    if (numbered && boldNumber && numbered[1] === boldNumber[1]) {
      const number = Number(numbered[1]);
      const rest = stripFootnoteMarks(text.slice(numbered[0].length));
      current = { documentId: 'ccc', number, text: rest, context, sourceUrl };
      units.push(current);
      continue;
    }
    // Bloco totalmente em negrito e sem número = título de secção.
    const bare = raw.replace(/<\/?(?:font|span|a)\b[^>]*>/gi, '').trim();
    if (/^<b>[\s\S]*<\/b>$/i.test(bare) && !/<\/b>[\s\S]*\S[\s\S]*<b>/i.test(bare.slice(3, -4))) {
      context = text;
      current = null;
      continue;
    }
    if (current) current.text = `${current.text}\n${stripFootnoteMarks(text)}`.trim();
  }
  return units;
}

export interface CccExtraction {
  units: ReferenceUnit[];
  /** Correções aplicadas a gralhas de numeração da fonte (registadas no relatório). */
  corrections: Array<{ found: number; correctedTo: number; reason: string }>;
}

/**
 * Junta as páginas por ordem e corrige gralhas de numeração da fonte: quando um número
 * quebra a sequência (ex.: "2117" entre 2216 e 2218) e o número esperado não existe em
 * mais lado nenhum, usa-se o esperado. Nada é inventado: só o número muda, não o texto.
 */
export function assembleCcc(pages: ReferenceUnit[][]): CccExtraction {
  const units = pages.flat();
  const present = new Set(units.map((u) => u.number));
  const corrections: CccExtraction['corrections'] = [];
  for (let i = 1; i < units.length; i++) {
    const prev = units[i - 1]!.number;
    const u = units[i]!;
    const expected = prev + 1;
    if (u.number <= prev && !present.has(expected)) {
      corrections.push({
        found: u.number,
        correctedTo: expected,
        reason: `fora de sequência entre §${prev} e §${units[i + 1]?.number ?? '?'}`,
      });
      u.number = expected;
      present.add(expected);
    }
  }
  return { units, corrections };
}
