import { describe, expect, it } from 'vitest';
import {
  assembleCcc,
  cccPagesFromIndex,
  parseCccPage,
} from '../../../src/modules/references/import/ccc-vatican.js';
import {
  linesFromItems,
  parseCicLines,
  type PdfLine,
} from '../../../src/modules/references/import/cic-cep.js';
import { validateComplete } from '../../../src/modules/references/import/import-sources.js';
import type { ReferenceUnit } from '../../../src/modules/references/domain/types.js';

// Fixtures sintéticas que imitam a marcação das fontes (nenhum texto real é versionado).
describe('Catecismo (vatican.va)', () => {
  it('lista as páginas de conteúdo do índice, sem índices nem links absolutos', () => {
    const html = `<a href="/holy_father/x_po.html">x</a><a href="prologo%201-25_po.html">P</a>
      <a href="index-prima-parte_po.html">I</a><a href="p1s1c1_26-49_po.html">1</a><a href="p1s1c1_26-49_po.html#a">1</a>`;
    expect(cccPagesFromIndex(html)).toEqual(['prologo%201-25_po.html', 'p1s1c1_26-49_po.html']);
  });

  it('reconhece variantes de marcação do número, títulos, citações e corta as notas', () => {
    const html = `<html><body>
      <p align="center"><b>ARTIGO 1</b></p>
      <p><b>1.</b> Alfa beta (1) gama.</p>
      <blockquote>Citação do alfa.</blockquote>
      <p><b>2<i>. </i></b>Delta &eacute;psilon.</p>
      <p></font><font face="Times New Roman"> <b>3.</b> Zeta.</p>
      <p><b>4</b> Eta.</p>
      <p><b>Em resumo:</b></p>
      <p><b>5.</b> Teta.</p>
      <hr><p>(1) Nota de rodapé que não entra.</p></body></html>`;
    const units = parseCccPage(html, 'https://example.va/p.html');
    expect(units.map((u) => u.number)).toEqual([1, 2, 3, 4, 5]);
    expect(units[0]).toMatchObject({ text: 'Alfa beta gama.\nCitação do alfa.', context: 'ARTIGO 1' });
    expect(units[1]!.text).toBe('Delta épsilon.');
    expect(units[4]!.context).toBe('Em resumo:');
    expect(units.some((u) => u.text.includes('rodapé'))).toBe(false);
  });

  it('corrige gralhas de numeração só quando o número esperado não existe', () => {
    const u = (number: number): ReferenceUnit => ({
      documentId: 'ccc',
      number,
      text: 't',
      context: null,
      sourceUrl: null,
    });
    const { units, corrections } = assembleCcc([
      [u(1), u(2)],
      [u(1), u(4)],
    ]);
    expect(units.map((x) => x.number)).toEqual([1, 2, 3, 4]);
    expect(corrections).toEqual([{ found: 1, correctedTo: 3, reason: expect.stringContaining('§2') }]);
  });
});

describe('Código de Direito Canónico (PDF da CEP)', () => {
  it('junta itens em linhas e deteta a translineação (item "-" isolado ou colado)', () => {
    const lines = linesFromItems([
      { str: '', x: 62, y: 500, height: 0, hasEOL: true },
      { str: 'Cân. 1 - Texto com pala', x: 62, y: 500, height: 11 },
      { str: '-', x: 360, y: 500, height: 11 },
      { str: 'vra cortada e', x: 48, y: 486, height: 11, hasEOL: true },
      { str: ' ', x: 120, y: 486, height: 0 },
      { str: 'motu proprio', x: 125, y: 486, height: 11 },
      { str: 'outra-', x: 48, y: 472, height: 11 },
    ]);
    expect(lines.map((l) => [l.text, l.softHyphen])).toEqual([
      ['Cân. 1 - Texto com pala', true],
      ['vra cortada e', false],
      ['motu proprio', false],
      ['outra', true],
    ]);
  });

  const L = (text: string, x = 48, height = 11): PdfLine => ({ text, x, y: 0, height, softHyphen: false });

  it('monta cânones com contexto, parágrafos, página e remissões que não abrem cânon', () => {
    const page1 = [
      L('Prefácio que é ignorado'),
      L('LIVRO I', 170, 13),
      L('DAS NORMAS GERAIS', 160, 13),
      L('Cân. 1 - Primeiro cânon que con', 62),
      { ...L('tinua'), softHyphen: false },
      L('§ 2. Segundo parágrafo, ver', 62),
      L('Cân. 5 sem ser cânon novo.', 48),
      L('7'),
    ];
    page1[3]!.softHyphen = true;
    const page2 = [
      L('TÍTULO I', 170, 13),
      L('DAS LEIS ECLESIÁSTICAS', 150, 13),
      L('Cân 2 Segundo cânon do', 65),
      L('Bem', 48),
      L('-aventurado.', 48),
    ];
    page2[3]!.softHyphen = true;
    const { units, warnings } = parseCicLines([page1, page2], 'https://x/cic.pdf');
    expect(warnings).toEqual([expect.stringContaining('"Cân. 5" fora de sequência')]);
    expect(units).toEqual([
      {
        documentId: 'cic',
        number: 1,
        text: 'Primeiro cânon que continua\n§ 2. Segundo parágrafo, ver Cân. 5 sem ser cânon novo.',
        context: 'Livro I — Das Normas Gerais',
        sourceUrl: 'https://x/cic.pdf#page=1',
      },
      {
        documentId: 'cic',
        number: 2,
        text: 'Segundo cânon do Bem-aventurado.',
        context: 'Livro I — Das Normas Gerais › Título I — Das Leis Eclesiásticas',
        sourceUrl: 'https://x/cic.pdf#page=2',
      },
    ]);
  });
});

describe('validateComplete', () => {
  const u = (number: number, text = 't'): ReferenceUnit => ({
    documentId: 'cic',
    number,
    text,
    context: null,
    sourceUrl: null,
  });
  it('exige 1..N sem buracos, repetidos nem textos vazios', () => {
    const all = Array.from({ length: 1752 }, (_, i) => u(i + 1));
    expect(() => validateComplete('cic', all)).not.toThrow();
    expect(() => validateComplete('cic', all.slice(1))).toThrow(/em falta \(1\): 1/);
    expect(() => validateComplete('cic', [...all, u(3)])).toThrow(/repetido: 3/);
    expect(() => validateComplete('cic', [...all.slice(0, -1), u(1752, ' ')])).toThrow(/vazio: 1752/);
  });
});
