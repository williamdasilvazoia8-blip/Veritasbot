import { describe, expect, it } from 'vitest';
import { ReferenceLibrary } from '../../../src/modules/references/application/reference-library.js';
import { DocumentAutoReplyService } from '../../../src/modules/references/application/document-auto-reply.js';
import { unitEmbeds } from '../../../src/modules/references/presentation/embeds.js';
import type {
  AutoReferenceSettings,
  IncomingMessage,
} from '../../../src/modules/bible/application/auto-reference-service.js';
import type { ReferenceUnit } from '../../../src/modules/references/domain/types.js';

const unit = (number: number, text: string): ReferenceUnit => ({
  documentId: 'ccc',
  number,
  text,
  context: 'Primeira parte',
  sourceUrl: 'https://www.vatican.va/archive/x.html',
});

const library = () =>
  new ReferenceLibrary([
    {
      id: 'ccc',
      edition: 'teste',
      importedAt: new Date(0),
      units: [unit(1, 'Oração e caridade.'), unit(2, 'Fé'), unit(4, 'Esperança e oração')],
    },
  ]);

describe('ReferenceLibrary', () => {
  it('devolve intervalos e indica números sem texto, sem os preencher', () => {
    expect(library().get('ccc', 1, 4)).toMatchObject({ ok: true, missing: [3] });
    expect(library().get('ccc', 3)).toEqual({ ok: false, error: 'not-found' });
    expect(library().get('ccc', 2866)).toEqual({ ok: false, error: 'out-of-range' });
    expect(library().get('cic', 1)).toEqual({ ok: false, error: 'not-imported' });
  });

  it('busca todas as palavras sem diferenciar acentos', () => {
    expect(
      library()
        .search('ccc', 'ORACAO')
        .map((h) => h.unit.number),
    ).toEqual([1, 4]);
    expect(
      library()
        .search('ccc', 'oração esperança')
        .map((h) => h.unit.number),
    ).toEqual([4]);
    expect(library().search('ccc', 'inexistente')).toEqual([]);
  });
});

describe('DocumentAutoReplyService', () => {
  const settings: AutoReferenceSettings = {
    enabled: true,
    allowedChannelIds: [],
    excludedChannelIds: ['x'],
    maxReferences: 3,
    cooldownSeconds: 5,
    allowWebhookMessages: false,
    psalmNumbering: 'vulgate',
    quotationMatchingEnabled: false,
    quotationMinWords: 10,
    quotationChannelIds: [],
  };
  let id = 0;
  const msg = (content: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({
    id: String(++id),
    guildId: 'g',
    channelId: 'c',
    content,
    authorIsBot: false,
    isWebhook: false,
    isSystem: false,
    ...extra,
  });

  it('responde, aplica cooldown por canal e ignora canais excluídos, bots e servidores fora da lista', () => {
    let now = 0;
    const svc = new DocumentAutoReplyService(library(), { isGuildAllowed: (g) => g === 'g', now: () => now });
    expect(svc.handle(msg('ver CCC 1-3'), settings)).toEqual([
      expect.objectContaining({
        missing: [3],
        units: [expect.objectContaining({ number: 1 }), expect.objectContaining({ number: 2 })],
      }),
    ]);
    expect(svc.handle(msg('CCC 2'), settings)).toEqual([]);
    now = 6000;
    expect(svc.handle(msg('CCC 2', { channelId: 'x' }), settings)).toEqual([]);
    expect(svc.handle(msg('CCC 2', { authorIsBot: true }), settings)).toEqual([]);
    expect(svc.handle(msg('CCC 2', { guildId: 'outro' }), settings)).toEqual([]);
    expect(svc.handle(msg('CCC 2'), { ...settings, enabled: false })).toEqual([]);
    expect(svc.handle(msg('CCC 3'), settings)).toEqual([]); // sem texto: silêncio
    expect(svc.handle(msg('CCC 2'), settings)).toHaveLength(1);
  });

  it('não responde duas vezes ao mesmo evento', () => {
    const svc = new DocumentAutoReplyService(library(), { isGuildAllowed: () => true });
    const m = msg('CCC 1');
    expect(svc.handle(m, { ...settings, cooldownSeconds: 0 })).toHaveLength(1);
    expect(svc.handle(m, { ...settings, cooldownSeconds: 0 })).toEqual([]);
  });
});

describe('unitEmbeds', () => {
  it('não repete o URL da embed (o Discord juntaria §27-30 numa só)', () => {
    const embeds = unitEmbeds('ccc', [unit(27, 'a'), unit(28, 'b'), unit(29, 'c')]);
    expect(embeds).toHaveLength(3);
    expect(embeds.every((e) => e.data.url === undefined)).toBe(true);
    expect(embeds.map((e) => e.data.title)).toEqual([
      'Catecismo da Igreja Católica, §27',
      'Catecismo da Igreja Católica, §28',
      'Catecismo da Igreja Católica, §29',
    ]);
  });

  it('atribui a fonte, liga à página oficial, escapa markdown e indica buracos', () => {
    const embeds = unitEmbeds('ccc', [unit(1, '*negrito* @everyone')], { missing: [3] });
    const e = embeds[0]!.data;
    expect(e.title).toBe('Catecismo da Igreja Católica, §1');
    expect(e.url).toBeUndefined();
    expect(e.description).toContain('[Texto oficial](https://www.vatican.va/archive/x.html)');
    expect(e.description).toContain('\\*negrito\\*');
    expect(e.description).not.toContain('@everyone');
    expect(e.description).toContain('Sem texto na fonte: §3.');
    expect(e.footer?.text).toContain('Libreria Editrice Vaticana');
  });
});
