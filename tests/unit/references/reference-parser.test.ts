import { describe, expect, it } from 'vitest';
import {
  parseDocumentReferences,
  MAX_RANGE,
} from '../../../src/modules/references/parsing/reference-parser.js';

const pick = (text: string) => parseDocumentReferences(text).map((r) => [r.documentId, r.start, r.end]);

describe('parseDocumentReferences', () => {
  it('Catecismo: CCC, CIC, Catecismo, § e n.º', () => {
    expect(pick('ccc 1234')).toEqual([['ccc', 1234, 1234]]);
    expect(pick('Veja o CIC §27-30')).toEqual([['ccc', 27, 30]]);
    expect(pick('catecismo n.º 2558')).toEqual([['ccc', 2558, 2558]]);
  });

  it('Código: CDC, cân., cânon(e), can. (com ponto)', () => {
    expect(pick('CDC 1055')).toEqual([['cic', 1055, 1055]]);
    expect(pick('cân. 1055 e cânones 1056-1057')).toEqual([
      ['cic', 1055, 1055],
      ['cic', 1056, 1057],
    ]);
    expect(pick('Cânon 212 §3')).toEqual([['cic', 212, 212]]);
    expect(pick('can. 5')).toEqual([['cic', 5, 5]]);
    expect(pick('I can 5 times')).toEqual([]);
  });

  it('mantém a ordem da mensagem e remove repetidos', () => {
    expect(pick('cân. 1 e depois CCC 2 e de novo cân. 1')).toEqual([
      ['cic', 1, 1],
      ['ccc', 2, 2],
    ]);
  });

  it('ignora números fora do documento, partes de palavras, código e vírgulas/decimais', () => {
    expect(pick('CCC 2866')).toEqual([]);
    expect(pick('CDC 1753')).toEqual([]);
    expect(pick('CCC 12345')).toEqual([]);
    expect(pick('abccc 12')).toEqual([]);
    expect(pick('`ccc 1`')).toEqual([]);
    expect(pick('CCC 1,2')).toEqual([]);
    expect(pick('CCC 30-27')).toEqual([]);
  });

  it(`corta intervalos longos a ${MAX_RANGE} e guarda o pedido`, () => {
    const [r] = parseDocumentReferences('CCC 10-20');
    expect(r).toMatchObject({ start: 10, end: 10 + MAX_RANGE - 1, requestedEnd: 20 });
  });

  it('respeita o máximo de referências', () => {
    expect(parseDocumentReferences('CCC 1, CCC 2, CCC 3, CCC 4', 2)).toHaveLength(2);
  });
});
