import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LiturgiaDiariaV2Client,
  LiturgiaDiariaV3Client,
} from '../../../src/modules/liturgy/providers/liturgia-diaria/client.js';
import { primaryCelebration } from '../../../src/modules/liturgy/domain/types.js';
import { fakeFetch, noSleep } from '../../helpers/fake-fetch.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/liturgia/${name}`, import.meta.url), 'utf8'));
const opts = (fetch: ReturnType<typeof fakeFetch>) => ({
  baseUrl: 'https://liturgia.example/',
  timeoutMs: 1000,
  maxBytes: 1_000_000,
  fetch,
  sleep: noSleep,
});

describe('LiturgiaDiariaV2Client', () => {
  it('consulta com dia, mês e ano explícitos no caminho /v2/', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-dia-comum.json') }]);
    await new LiturgiaDiariaV2Client(opts(f)).getDay('2026-10-16', 'pt-BR');
    expect(f.calls).toEqual(['https://liturgia.example/v2/?dia=16&mes=10&ano=2026']);
  });

  it('normaliza dia comum; segunda leitura em texto livre vira ausência', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-dia-comum.json') }]);
    const day = (await new LiturgiaDiariaV2Client(opts(f)).getDay('2026-10-16', 'pt-BR'))!;
    expect(day).toMatchObject({ date: '2026-10-16', source: 'dancrf-liturgia-diaria', sourceVersion: 'v2' });
    const c = primaryCelebration(day)!;
    expect(c).toMatchObject({
      name: 'Sexta-feira da 28ª Semana do Tempo Comum',
      color: 'Verde',
      isPrimary: true,
    });
    expect(c.readings.map((r) => r.label)).toEqual(['Primeira Leitura', 'Salmo Responsorial', 'Evangelho']);
  });

  it('Vigília Pascal: preserva alternativas e extras', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-vigilia-pascal.json') }]);
    const day = (await new LiturgiaDiariaV2Client(opts(f)).getDay('2025-04-19', 'pt-BR'))!;
    const c = day.celebrations[0]!;
    expect(c.readings.find((r) => r.label === 'Primeira Leitura')!.options).toHaveLength(2);
    expect(c.readings.find((r) => r.type === 'salmo')!.options.map((o) => o.reference)).toEqual([
      'Sl 103',
      'Ex 15, 1-6. 17-18',
    ]);
    const extras = c.readings.filter((r) => r.type === 'extra');
    expect(extras.map((e) => e.label)).toEqual([
      'Proclamação da Páscoa (Exulte)',
      'Terceira Leitura',
      'Epístola',
    ]);
    expect(c.readings.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(c.prayers.extras.map((e) => e.title)).toEqual(['Benção do fogo', 'Depois da primeira leitura']);
  });

  it('404 → null (liturgia não encontrada), sem inventar', async () => {
    const f = fakeFetch([
      { status: 404, body: { erro: 'Não encontramos nenhuma liturgia para esta data', data: '01/02/2080' } },
    ]);
    expect(await new LiturgiaDiariaV2Client(opts(f)).getDay('2080-02-01', 'pt-BR')).toBeNull();
  });

  it('rejeita resposta de outra data', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-dia-comum.json') }]);
    await expect(new LiturgiaDiariaV2Client(opts(f)).getDay('2026-10-17', 'pt-BR')).rejects.toMatchObject({
      kind: 'date-mismatch',
    });
  });

  it('rejeita resposta fora do formato', async () => {
    const f = fakeFetch([{ status: 200, body: { data: '16/10/2026' } }]);
    await expect(new LiturgiaDiariaV2Client(opts(f)).getDay('2026-10-16', 'pt-BR')).rejects.toMatchObject({
      kind: 'invalid-schema',
    });
  });

  it('tolera campos ausentes', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          data: '16/10/2026',
          liturgia: 'Dia',
          leituras: { evangelho: [{ referencia: 'Lc 1', texto: 't' }] },
        },
      },
    ]);
    const day = (await new LiturgiaDiariaV2Client(opts(f)).getDay('2026-10-16', 'pt-BR'))!;
    expect(day.celebrations[0]).toMatchObject({ color: null, prayers: { extras: [] }, antiphons: {} });
    expect(day.celebrations[0]!.readings).toHaveLength(1);
  });
});

describe('LiturgiaDiariaV3Client (beta)', () => {
  it('usa o caminho /v3/ e preserva várias celebrações e a principal', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v3-memoria-facultativa.json') }]);
    const day = (await new LiturgiaDiariaV3Client(opts(f)).getDay('2024-01-03', 'pt-BR'))!;
    expect(f.calls[0]).toBe('https://liturgia.example/v3/?dia=03&mes=01&ano=2024');
    expect(day.celebrations).toHaveLength(2);
    expect(primaryCelebration(day)!.id).toBe('4-feira-do-tempo-do-natal-antes-da-epifania');
    expect(day.celebrations.filter((c) => c.isPrimary)).toHaveLength(1);
  });

  it('ordena leituras por `ordem` e mantém opções', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v3-memoria-facultativa.json') }]);
    const c = primaryCelebration((await new LiturgiaDiariaV3Client(opts(f)).getDay('2024-01-03', 'pt-BR'))!)!;
    expect(c.readings.map((r) => [r.order, r.type])).toEqual([
      [1, 'leitura'],
      [2, 'salmo'],
      [3, 'evangelho'],
    ]);
    expect(c.readings[1]!.options.map((o) => o.refrain)).toEqual(['[refrão A]', '[refrão B]']);
  });

  it('esquemas v2 e v3 são independentes', async () => {
    const f = fakeFetch([{ status: 200, body: fixture('v2-dia-comum.json') }]);
    await expect(new LiturgiaDiariaV3Client(opts(f)).getDay('2026-10-16', 'pt-BR')).rejects.toMatchObject({
      kind: 'invalid-schema',
    });
  });
});
