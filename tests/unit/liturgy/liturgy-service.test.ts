import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeLiturgyFailure,
  LiturgyService,
} from '../../../src/modules/liturgy/application/liturgy-service.js';
import { LiturgiaDiariaV2Client } from '../../../src/modules/liturgy/providers/liturgia-diaria/client.js';
import type { LiturgicalDay, LiturgyProvider } from '../../../src/modules/liturgy/domain/types.js';
import {
  liturgyDayEmbed,
  LITURGY_FOOTER,
  readingTextEmbeds,
} from '../../../src/modules/liturgy/presentation/embeds.js';
import { localDate } from '../../../src/shared/dates.js';
import { fakeFetch, noSleep } from '../../helpers/fake-fetch.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/liturgia/${name}`, import.meta.url), 'utf8'));

function stubProvider(
  map: Record<string, LiturgicalDay | null | Error>,
): LiturgyProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    version: 'v2',
    calls,
    async getDay(date) {
      calls.push(date);
      const v = map[date];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  };
}
const day = (date: string, name = 'Dia'): LiturgicalDay => ({
  date,
  source: 'dancrf-liturgia-diaria',
  sourceVersion: 'v2',
  celebrations: [
    { id: 'x', name, isPrimary: true, color: 'Verde', prayers: { extras: [] }, antiphons: {}, readings: [] },
  ],
});

describe('LiturgyService', () => {
  it('usa cache por data e versão', async () => {
    const p = stubProvider({ '2026-10-16': day('2026-10-16') });
    const s = new LiturgyService({ providers: { v2: p }, defaultVersion: 'v2', v3Enabled: false });
    expect((await s.getDay('2026-10-16', 'v2')).status).toBe('ok');
    expect(await s.getDay('2026-10-16', 'v2')).toMatchObject({ status: 'ok', cached: true });
    expect(p.calls).toHaveLength(1);
  });

  it('404 vira "não encontrada" com mensagem honesta', async () => {
    const s = new LiturgyService({
      providers: { v2: stubProvider({}) },
      defaultVersion: 'v2',
      v3Enabled: false,
    });
    const r = await s.getDay('2080-02-01', 'v2');
    expect(r.status).toBe('not-found');
    if (r.status !== 'ok') expect(describeLiturgyFailure(r)).toMatch(/não encontrada/i);
  });

  it('falha do provedor não derruba e não inventa conteúdo', async () => {
    const f = fakeFetch([{ status: 503 }]);
    const client = new LiturgiaDiariaV2Client({
      baseUrl: 'https://x',
      timeoutMs: 100,
      maxBytes: 10_000,
      fetch: f,
      sleep: noSleep,
      maxAttempts: 2,
    });
    const s = new LiturgyService({ providers: { v2: client }, defaultVersion: 'v2', v3Enabled: false });
    const r = await s.getDay('2026-10-16', 'v2');
    expect(r).toMatchObject({ status: 'error', kind: 'http' });
    expect(f.calls).toHaveLength(2);
  });

  it('getRange busca datas explícitas (não usa `periodo`)', async () => {
    const f = fakeFetch([{ status: 404, body: {} }]);
    const client = new LiturgiaDiariaV2Client({
      baseUrl: 'https://x',
      timeoutMs: 100,
      maxBytes: 10_000,
      fetch: f,
      sleep: noSleep,
    });
    const s = new LiturgyService({ providers: { v2: client }, defaultVersion: 'v2', v3Enabled: false });
    const r = await s.getRange('2026-12-30', 3, 'v2');
    expect(r).toHaveLength(3);
    expect(f.calls.sort()).toEqual([
      'https://x/v2/?dia=01&mes=01&ano=2027',
      'https://x/v2/?dia=30&mes=12&ano=2026',
      'https://x/v2/?dia=31&mes=12&ano=2026',
    ]);
    expect(f.calls.some((u) => u.includes('periodo'))).toBe(false);
  });

  it('v3 só é usada com a flag global', () => {
    const p = stubProvider({});
    expect(
      new LiturgyService({
        providers: { v2: p, v3: { ...p, version: 'v3' } },
        defaultVersion: 'v2',
        v3Enabled: false,
      }).resolveVersion('v3'),
    ).toBe('v2');
    expect(
      new LiturgyService({
        providers: { v2: p, v3: { ...p, version: 'v3' } },
        defaultVersion: 'v2',
        v3Enabled: true,
      }).resolveVersion('v3'),
    ).toBe('v3');
  });
});

describe('datas locais por fuso (hoje/amanhã)', () => {
  // 2026-10-16T01:30Z: ainda dia 15 em São Paulo (UTC-3), já dia 16 em Lisboa (UTC+1).
  const instant = new Date('2026-10-16T01:30:00Z');
  it('calcula "hoje" no fuso do servidor, não no do host nem da API', () => {
    expect(localDate('America/Sao_Paulo', 0, instant)).toBe('2026-10-15');
    expect(localDate('Europe/Lisbon', 0, instant)).toBe('2026-10-16');
    expect(localDate('Europe/Lisbon', 1, instant)).toBe('2026-10-17');
  });
});

describe('apresentação', () => {
  it('nunca rotula o texto da API como Matos Soares', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-vigilia-pascal.json') }]);
    const d = (await new LiturgiaDiariaV2Client({
      baseUrl: 'https://x',
      timeoutMs: 100,
      maxBytes: 1e6,
      fetch: f,
    }).getDay('2025-04-19', 'pt-BR'))!;
    const c = d.celebrations[0]!;
    const gospel = readingTextEmbeds(
      d,
      c,
      c.readings.find((r) => r.type === 'evangelho')!,
    );
    const footer = gospel.at(-1)!.data.footer!.text;
    expect(footer).toContain('Liturgia Diária (Dancrf)');
    expect(footer).toContain('não da tradução Matos Soares');
    expect(LITURGY_FOOTER).not.toMatch(/^.*trad\. Pe\. Manuel de Matos Soares/);
    const summary = liturgyDayEmbed(d).toJSON();
    expect(summary.fields!.find((x) => x.name === 'Leituras')!.value).toContain(
      'Gn 1, 1-2, 2 (Forma Longa)* ou *'.replace('* ou *', ''),
    );
  });
});
