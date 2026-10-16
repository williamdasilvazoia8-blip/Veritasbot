import { describe, expect, it } from 'vitest';
import {
  AutoReferenceService,
  type AutoReferenceSettings,
  type IncomingMessage,
} from '../../../src/modules/bible/application/auto-reference-service.js';
import { QuotationMatcher } from '../../../src/modules/bible/search/quotation-matcher.js';
import { InMemoryBibleProvider } from '../../../src/modules/bible/application/in-memory-corpus.js';
import { DISTINCTIVE, syntheticProvider } from '../../fixtures/bible/synthetic.js';

const provider = syntheticProvider();
const settings = (over: Partial<AutoReferenceSettings> = {}): AutoReferenceSettings => ({
  enabled: true,
  allowedChannelIds: [],
  excludedChannelIds: [],
  maxReferences: 3,
  cooldownSeconds: 0,
  allowWebhookMessages: false,
  psalmNumbering: 'vulgate',
  quotationMatchingEnabled: false,
  quotationMinWords: 8,
  quotationChannelIds: [],
  ...over,
});
let seq = 0;
const msg = (content: string, over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: `m${++seq}`,
  guildId: 'g1',
  channelId: 'c1',
  content,
  authorIsBot: false,
  isWebhook: false,
  isSystem: false,
  ...over,
});
const service = (over: Partial<ConstructorParameters<typeof AutoReferenceService>[1]> = {}) =>
  new AutoReferenceService(provider, {
    maxVersesPerPassage: 20,
    globalEnabled: true,
    quotationGloballyEnabled: true,
    ...over,
  });

describe('AutoReferenceService', () => {
  it('responde a uma mensagem comum contendo apenas "João 3:16"', async () => {
    const r = await service().handle(msg('João 3:16'), settings());
    expect(r?.kind).toBe('passages');
    if (r?.kind === 'passages') expect(r.passages[0]!.verses[0]!.text).toBe(DISTINCTIVE['JHN.3.16']);
  });

  it('ignora bots, mensagens de sistema e webhooks (salvo permissão)', async () => {
    const s = service();
    expect(await s.handle(msg('João 3:16', { authorIsBot: true }), settings())).toBeNull();
    expect(await s.handle(msg('João 3:16', { isSystem: true }), settings())).toBeNull();
    expect(await s.handle(msg('João 3:16', { isWebhook: true }), settings())).toBeNull();
    expect(
      await s.handle(msg('João 3:16', { isWebhook: true }), settings({ allowWebhookMessages: true })),
    ).not.toBeNull();
  });

  it('ignora referências em blocos de código', async () => {
    expect(await service().handle(msg('```\nJoão 3:16\n```'), settings())).toBeNull();
  });

  it('não responde duas vezes ao mesmo evento de mensagem', async () => {
    const s = service();
    const m = msg('João 3:16');
    expect(await s.handle(m, settings())).not.toBeNull();
    expect(await s.handle({ ...m }, settings())).toBeNull();
  });

  it('aplica cooldown por canal', async () => {
    let now = 1_000_000;
    const s = service({ now: () => now });
    expect(await s.handle(msg('João 3:16'), settings({ cooldownSeconds: 10 }))).not.toBeNull();
    expect(await s.handle(msg('Romanos 8:28'), settings({ cooldownSeconds: 10 }))).toBeNull();
    expect(
      await s.handle(msg('Romanos 8:28', { channelId: 'c2' }), settings({ cooldownSeconds: 10 })),
    ).not.toBeNull();
    now += 11_000;
    expect(await s.handle(msg('Romanos 8:28'), settings({ cooldownSeconds: 10 }))).not.toBeNull();
  });

  it('respeita canais excluídos e permitidos (inclusive por categoria/thread pai)', async () => {
    const s = service();
    expect(await s.handle(msg('João 3:16'), settings({ excludedChannelIds: ['c1'] }))).toBeNull();
    expect(await s.handle(msg('João 3:16'), settings({ allowedChannelIds: ['c9'] }))).toBeNull();
    expect(
      await s.handle(
        msg('João 3:16', { parentChannelId: 'cat1' }),
        settings({ allowedChannelIds: ['cat1'] }),
      ),
    ).not.toBeNull();
  });

  it('referências inválidas não geram resposta nem texto inventado', async () => {
    expect(await service().handle(msg('João 99:1'), settings())).toBeNull();
  });

  it('limita o número de referências por mensagem', async () => {
    const r = await service().handle(msg('Jo 1:1, Rm 1:1, Gn 1:1, Ap 1:1'), settings({ maxReferences: 2 }));
    expect(r?.kind === 'passages' && r.passages).toHaveLength(2);
  });

  it('passagem longa vira aviso de truncamento', async () => {
    const r = await service().handle(msg('Jo 1:1-40'), settings());
    expect(r).toMatchObject({ kind: 'passages', passages: [], truncated: [{ verseCount: 40 }] });
  });

  it('desligado no servidor ou globalmente não responde', async () => {
    expect(await service().handle(msg('João 3:16'), settings({ enabled: false }))).toBeNull();
    expect(await service({ globalEnabled: false }).handle(msg('João 3:16'), settings())).toBeNull();
  });

  it('sem edição importada, não responde', async () => {
    const s = new AutoReferenceService(InMemoryBibleProvider.empty(), {
      maxVersesPerPassage: 20,
      globalEnabled: true,
      quotationGloballyEnabled: false,
    });
    expect(await s.handle(msg('João 3:16'), settings())).toBeNull();
  });

  it('converte numeração hebraica de Salmos quando configurado', async () => {
    const r = await service().handle(msg('Salmos 23:1'), settings({ psalmNumbering: 'hebrew' }));
    expect(r?.kind === 'passages' && r.passages[0]!.reference.chapter).toBe(22);
    // H 10 não corresponde a um único salmo da Vulgata: não responde
    expect(await service().handle(msg('Salmos 10:1'), settings({ psalmNumbering: 'hebrew' }))).toBeNull();
  });

  describe('identificação de citações', () => {
    const matcher = new QuotationMatcher(provider.allVerses());
    const quoting = () => service({ getQuotationMatcher: () => matcher });

    it('fica desligada por padrão', async () => {
      expect(await quoting().handle(msg(DISTINCTIVE['JHN.3.16']!), settings())).toBeNull();
    });

    it('identifica texto colado quando ativada', async () => {
      const r = await quoting().handle(
        msg(`Olhem: ${DISTINCTIVE['JHN.3.16']}`),
        settings({ quotationMatchingEnabled: true }),
      );
      expect(r?.kind).toBe('quotation');
      if (r?.kind === 'quotation')
        expect(r.passage.reference).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 16 });
    });

    it('texto comum não gera correspondência', async () => {
      const r = await quoting().handle(
        msg('hoje vou ao mercado comprar pão leite e café para toda a família'),
        settings({ quotationMatchingEnabled: true }),
      );
      expect(r).toBeNull();
    });
  });
});

describe('channelRule', () => {
  it('excluído ganha; lista de permitidos vale para o canal ou a categoria', async () => {
    const { channelRule } = await import('../../../src/modules/bible/application/auto-reference-service.js');
    expect(channelRule(['c', 'cat'], [], [])).toBe('ok');
    expect(channelRule(['c', 'cat'], ['cat'], [])).toBe('ok');
    expect(channelRule(['c', null], ['outro'], [])).toBe('not-allowed');
    expect(channelRule(['c', 'cat'], ['c'], ['cat'])).toBe('excluded');
  });
});
