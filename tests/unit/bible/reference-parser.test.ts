import { describe, expect, it } from 'vitest';
import {
  findBook,
  parseReferences,
  parseSingleReference,
} from '../../../src/modules/bible/parsing/reference-parser.js';

const auto = (text: string) => parseReferences(text, { strict: true, requireVerse: true });
const simple = (text: string) =>
  auto(text).map(
    (r) =>
      `${r.bookId} ${r.chapter}:${r.verseStart}${r.verseEnd !== undefined ? `-${r.chapterEnd !== r.chapter ? `${r.chapterEnd}:` : ''}${r.verseEnd}` : ''}`,
  );

describe('parseReferences — exemplos da especificação', () => {
  it.each([
    ['João 3:16', ['JHN 3:16']],
    ['João 3,16', ['JHN 3:16']],
    ['Jo 3:16', ['JHN 3:16']],
    ['João 3:16-18', ['JHN 3:16-18']],
    ['Romanos 8:28', ['ROM 8:28']],
    ['1 Coríntios 13:4-7', ['1CO 13:4-7']],
    ['1 Cor 13,4-7', ['1CO 13:4-7']],
    ['Salmos 22:1', ['PSA 22:1']],
    ['Apocalipse 21:4', ['REV 21:4']],
    ['O que acham de Mateus 16:18?', ['MAT 16:18']],
    ['Leiam João 1:1 e Romanos 8:28.', ['JHN 1:1', 'ROM 8:28']],
  ])('%s', (text, expected) => {
    expect(simple(text)).toEqual(expected);
  });

  it('reconhece mensagem contendo SOMENTE a referência', () => {
    const [ref] = auto('João 3:16');
    expect(ref).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 16, raw: 'João 3:16', index: 0 });
  });
});

describe('livros numerados e homônimos', () => {
  it('não confunde 1 João com João', () => {
    expect(simple('1 João 4:8')).toEqual(['1JN 4:8']);
    expect(simple('1Jo 4,8')).toEqual(['1JN 4:8']);
    expect(simple('I João 4:8')).toEqual(['1JN 4:8']);
    expect(simple('3 João 1:2')).toEqual(['3JN 1:2']);
    expect(simple('João 4:8')).toEqual(['JHN 4:8']);
  });

  it('distingue Coríntios numerados', () => {
    expect(simple('2 Coríntios 5:17')).toEqual(['2CO 5:17']);
    expect(simple('2Cor 5,17')).toEqual(['2CO 5:17']);
  });

  it('distingue Jó (acentuado) de Jo (João)', () => {
    expect(simple('Jó 1:21')).toEqual(['JOB 1:21']);
    expect(simple('Jo 1:21')).toEqual(['JHN 1:21']);
  });

  it('distingue 1 Mc (Macabeus) de Mc (Marcos)', () => {
    expect(simple('1 Mc 2:3')).toEqual(['1MA 2:3']);
    expect(simple('Mc 2:3')).toEqual(['MRK 2:3']);
  });

  it('aceita nomes compostos e sem acento', () => {
    expect(simple('Cântico dos Cânticos 2:4')).toEqual(['SNG 2:4']);
    expect(simple('joao 3:16')).toEqual(['JHN 3:16']);
  });
});

describe('falsos positivos evitados', () => {
  it.each([
    'chego às 3:16',
    'placar 2:1',
    'tenho 2 joãozinhos 3:16',
    'os 3:16 minutos',
    'na 2:30 da tarde',
    'ex 2:30',
    'mal 1:2',
  ])('ignora "%s"', (text) => {
    expect(auto(text)).toEqual([]);
  });

  it('aliases ambíguos valem com inicial maiúscula', () => {
    expect(simple('Os 11:1')).toEqual(['HOS 11:1']);
  });

  it('ignora referências em blocos de código', () => {
    expect(auto('```\nJoão 3:16\n```')).toEqual([]);
    expect(auto('veja `João 3:16` no exemplo')).toEqual([]);
    expect(simple('```x``` mas Romanos 8:28 vale')).toEqual(['ROM 8:28']);
  });

  it('exige versículo na detecção automática', () => {
    expect(auto('Leia João 3 hoje')).toEqual([]);
  });

  it('rejeita intervalos invertidos', () => {
    expect(auto('Jo 3:16-4')).toEqual([]);
    expect(auto('Gn 2:1-1:3')).toEqual([]);
  });
});

describe('intervalos e múltiplas referências', () => {
  it('interpreta intervalo entre capítulos', () => {
    expect(simple('Gn 1,1-2,3')).toEqual(['GEN 1:1-2:3']);
  });

  it('remove duplicatas e respeita o máximo', () => {
    expect(simple('João 3:16 e de novo João 3,16')).toEqual(['JHN 3:16']);
    expect(parseReferences('Jo 1:1, Rm 1:1, Gn 1:1, Ap 1:1', { maxResults: 2 })).toHaveLength(2);
  });
});

describe('parseSingleReference e findBook', () => {
  it('aceita capítulo inteiro em comandos', () => {
    expect(parseSingleReference('Sl 22')).toMatchObject({ bookId: 'PSA', chapter: 22 });
    expect(parseSingleReference('Sl 22')?.verseStart).toBeUndefined();
  });

  it('encontra livros por nome ou abreviação', () => {
    expect(findBook('Gênesis')?.id).toBe('GEN');
    expect(findBook('1 cor')?.id).toBe('1CO');
    expect(findBook('Jó')?.id).toBe('JOB');
    expect(findBook('inexistente')).toBeUndefined();
  });
});
