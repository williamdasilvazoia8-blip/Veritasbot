import type { ReferenceUnit } from '../domain/types.js';

/**
 * Extração do Código de Direito Canónico (versão portuguesa atualizada da Conferência
 * Episcopal Portuguesa, PDF de 2025). O PDF é paginado em InDesign:
 * - cada cânon começa numa linha "Cân. N - …" (há variantes sem hífen ou sem ponto);
 * - as linhas com recuo iniciam um novo parágrafo (§ 2., 1.º …);
 * - a translineação aparece como um "-" isolado no fim da linha (raramente colado à palavra);
 *   quando a quebra cai num hífen real, a norma portuguesa repete-o no início da linha
 *   seguinte ("Bem-" / "-aventurados");
 * - os títulos (LIVRO, PARTE, SECÇÃO, TÍTULO, CAPÍTULO, Art.) são centrados e maiores;
 * - os números de página são linhas só com dígitos no rodapé.
 */

export const CIC_PDF_URL =
  'https://www.conferenciaepiscopal.pt/v1/wp-content/uploads/2026/04/CIC_SiteCEP.pdf';
export const CIC_MAX = 1752;

/** Fragmento de texto de uma página do PDF (subconjunto de TextItem do pdf.js). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  height: number;
  hasEOL?: boolean;
}

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  height: number;
  /** A linha termina num hífen de translineação (já retirado de `text`). */
  softHyphen: boolean;
}

/** Agrupa os itens de uma página em linhas (mesmo y), pela ordem de leitura. */
export function linesFromItems(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let parts: PdfTextItem[] = [];
  const flush = () => {
    const visible = parts.filter((p) => p.str.length > 0);
    parts = [];
    if (visible.length === 0) return;
    const last = visible[visible.length - 1]!;
    const separateHyphen = visible.length > 1 && last.str === '-';
    const body = separateHyphen ? visible.slice(0, -1) : visible;
    let text = body
      .map((p) => p.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;
    const attachedHyphen = !separateHyphen && /\p{L}-$/u.test(text);
    if (attachedHyphen) text = text.slice(0, -1);
    const softHyphen = separateHyphen || attachedHyphen;
    const first = body.find((p) => p.str.trim()) ?? body[0]!;
    lines.push({
      text,
      x: first.x,
      y: first.y,
      height: Math.max(...body.map((p) => p.height)),
      softHyphen,
    });
  };
  for (const item of items) {
    if (parts.length > 0 && Math.abs(item.y - parts[0]!.y) > 2) flush();
    if (item.str.length > 0 || parts.length > 0) parts.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

const HEADING_LEVELS = ['LIVRO', 'PARTE', 'SECÇÃO', 'TÍTULO', 'CAPÍTULO', 'Art.'] as const;
const HEADING_RE = /^(LIVRO|PARTE|SECÇÃO|TÍTULO|CAPÍTULO)\s+([IVXLC]+|ÚNIC[OA])$|^(Art\.)\s*(\d+)$/;
const CANON_RE = /^C[âa]n\.?\s*(\d{1,4})\s*(?:[-–—]\s*)?/;

export interface CicExtraction {
  units: ReferenceUnit[];
  warnings: string[];
}

interface Draft {
  number: number;
  paragraphs: string[];
  context: string | null;
  page: number;
  /** A última linha acabou num hífen de translineação. */
  hyphenPending: boolean;
}

/**
 * Converte as linhas de todas as páginas em cânones. Só aceita cabeçalhos em sequência
 * (N+1), para que uma remissão como "Cân. 5" no meio do texto nunca abra um cânon novo.
 */
export function parseCicLines(pages: PdfLine[][], sourceUrl: string | null = CIC_PDF_URL): CicExtraction {
  const warnings: string[] = [];
  const all = pages.flatMap((lines, pageIndex) =>
    lines
      // Números de página.
      .filter((l) => !/^\d{1,3}$/.test(l.text))
      .map((l) => ({ ...l, page: pageIndex + 1 })),
  );

  const headings: Array<string | null> = HEADING_LEVELS.map(() => null);
  let pendingHeading: { level: number; label: string; title: string[] } | null = null;
  let current: Draft | null = null;
  const drafts: Draft[] = [];
  let started = false;
  const baseX = marginX(all);

  const context = () => headings.filter(Boolean).join(' › ') || null;
  const closeHeading = () => {
    if (!pendingHeading) return;
    const { level, label, title } = pendingHeading;
    headings[level] = title.length ? `${label} — ${titleCase(title.join(' '))}` : label;
    for (let i = level + 1; i < headings.length; i++) headings[i] = null;
    pendingHeading = null;
  };

  for (const line of all) {
    const text = line.text;
    if (!started) {
      if (/^LIVRO I$/.test(text)) started = true;
      else continue;
    }
    if (current && current.number === CIC_MAX && /^ANEXOS?$/.test(text)) break;

    const heading = HEADING_RE.exec(text);
    if (heading) {
      closeHeading();
      const word = heading[1] ?? heading[3]!;
      pendingHeading = {
        level: HEADING_LEVELS.indexOf(word as (typeof HEADING_LEVELS)[number]),
        label: `${word === 'Art.' ? 'Artigo' : titleCase(word)} ${heading[2] ?? heading[4]}`,
        title: [],
      };
      current = null;
      continue;
    }

    const expected = (drafts.at(-1)?.number ?? 0) + 1;
    const canon = CANON_RE.exec(text);
    if (canon && Number(canon[1]) === expected && line.x <= baseX + 30) {
      closeHeading();
      current = {
        number: expected,
        paragraphs: [text.slice(canon[0].length)],
        context: context(),
        page: line.page,
        hyphenPending: line.softHyphen,
      };
      drafts.push(current);
      continue;
    }
    if (canon && Number(canon[1]) !== expected && line.x <= baseX + 30 && line.height < 12)
      warnings.push(
        `p. ${line.page}: "Cân. ${canon[1]}" fora de sequência (esperado ${expected}) — tratado como texto`,
      );

    // Título por extenso, em maiúsculas, nas linhas a seguir a "CAPÍTULO II" etc.
    if (pendingHeading && (line.height >= 12 || isUpperCase(text))) {
      pendingHeading.title.push(text);
      continue;
    }
    if (!current) {
      if (text.trim()) warnings.push(`p. ${line.page}: texto fora de cânon ignorado: "${text.slice(0, 60)}"`);
      continue;
    }
    // Linha recuada = novo parágrafo (§ 2., 1.º …); as outras continuam o anterior.
    const last = current.paragraphs.length - 1;
    if (line.x > baseX + 5) current.paragraphs.push(text);
    else current.paragraphs[last] = joinLine(current.paragraphs[last]!, text, current.hyphenPending);
    current.hyphenPending = line.softHyphen;
  }
  closeHeading();

  const units: ReferenceUnit[] = drafts.map((d) => ({
    documentId: 'cic',
    number: d.number,
    text: d.paragraphs.join('\n').trim(),
    context: d.context,
    // Os leitores de PDF dos navegadores abrem diretamente na página indicada.
    sourceUrl: sourceUrl ? `${sourceUrl}#page=${d.page}` : null,
  }));
  return { units, warnings };
}

function joinLine(head: string, next: string, hyphen: boolean): string {
  if (!hyphen) return `${head} ${next}`;
  // O hífen de translineação já foi retirado; se a palavra tinha hífen real, a linha
  // seguinte começa por ele ("Bem" + "-aventurados").
  return `${head}${next}`;
}

/** Margem esquerda do texto corrido: o x mais frequente (as 1.as linhas têm recuo). */
function marginX(lines: PdfLine[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(Math.round(l.x), (counts.get(Math.round(l.x)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function isUpperCase(s: string): boolean {
  return /\p{Lu}/u.test(s) && s === s.toUpperCase();
}

const MINOR_WORDS = new Set(
  'de da do das dos e a o as os em na no nas nos ao aos à às por para com que ou um uma'.split(' '),
);

/** "DOS OFÍCIOS ECLESIÁSTICOS" → "Dos Ofícios Eclesiásticos"; numerais romanos ficam. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && /^[IVXLC]+$/.test(w)) return w;
      const lower = w.toLowerCase();
      return i > 0 && MINOR_WORDS.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Lê o PDF (pdf.js via unpdf, sem binários nativos — corre num dyno Heroku). */
export async function extractCicFromPdf(data: Uint8Array): Promise<CicExtraction> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(data);
  const pages: PdfLine[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      items.push({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        height: it.height,
        hasEOL: it.hasEOL,
      });
    }
    pages.push(linesFromItems(items));
    page.cleanup();
  }
  await pdf.cleanup();
  return parseCicLines(pages);
}
