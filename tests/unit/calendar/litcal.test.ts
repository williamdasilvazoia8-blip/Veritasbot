import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LitcalClient } from '../../../src/modules/calendar/providers/litcal/client.js';
import { SaintsService } from '../../../src/modules/calendar/application/saints-service.js';
import { fakeFetch, noSleep } from '../../helpers/fake-fetch.js';

// Recorte de saída real do LitCal (golden master do projeto, Apache-2.0).
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/litcal/general-2024-excerpt.json', import.meta.url), 'utf8'),
);
const client = (f: ReturnType<typeof fakeFetch>) =>
  new LitcalClient({
    baseUrl: 'https://litcal.example/api/v5/',
    timeoutMs: 1000,
    maxBytes: 5e6,
    fetch: f,
    sleep: noSleep,
  });

describe('LitcalClient', () => {
  it('pede o ANO CIVIL do calendário geral com o idioma no Accept-Language', async () => {
    let headers: Headers | undefined;
    const f = fakeFetch([{ status: 200, body: fixture }]);
    const wrapped = Object.assign(
      async (url: string, init?: RequestInit) => {
        headers = new Headers(init?.headers);
        return f(url, init);
      },
      { calls: f.calls },
    );
    await client(wrapped).getYear(2024, 'GENERAL', 'la');
    expect(f.calls).toEqual(['https://litcal.example/api/v5/calendar/2024?year_type=CIVIL']);
    expect(headers?.get('accept-language')).toBe('la');
  });

  it('usa a rota nacional quando configurado', async () => {
    const f = fakeFetch([{ status: 200, body: fixture }]);
    await client(f).getYear(2024, 'IT', 'it');
    expect(f.calls[0]).toBe('https://litcal.example/api/v5/calendar/nation/IT/2024?year_type=CIVIL');
  });

  it('rejeita resposta fora do formato', async () => {
    const f = fakeFetch([{ status: 200, body: { foo: 1 } }]);
    await expect(client(f).getYear(2024, 'GENERAL', 'la')).rejects.toMatchObject({ kind: 'invalid-schema' });
  });
});

describe('SaintsService', () => {
  it('lista santos da data civil, ordenados por grau, sem a féria', async () => {
    const s = new SaintsService(client(fakeFetch([{ status: 200, body: fixture }])));
    const r = await s.getDay('2024-10-16', 'GENERAL', 'la');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.celebrations.map((c) => c.key)).toEqual(['StHedwig', 'StMargaretAlacoque']);
    expect(r.celebrations[0]!.gradeLabel).toBe('memoria ad libitum');
  });

  it('pode omitir memórias facultativas', async () => {
    const s = new SaintsService(client(fakeFetch([{ status: 200, body: fixture }])));
    const r = await s.getDay('2024-10-16', 'GENERAL', 'la', { includeOptional: false });
    expect(r.status === 'ok' && r.celebrations).toEqual([]);
    const r2 = await s.getDay('2024-10-17', 'GENERAL', 'la', { includeOptional: false });
    expect(r2.status === 'ok' && r2.celebrations.map((c) => c.key)).toEqual(['StIgnatiusAntioch']);
  });

  it('exclui Missas de vigília (pertencem à celebração do dia seguinte)', async () => {
    const s = new SaintsService(client(fakeFetch([{ status: 200, body: fixture }])));
    const r = await s.getDay('2023-12-24', 'GENERAL', 'la');
    expect(r.status === 'ok' && r.celebrations.map((c) => c.key)).toEqual(['Advent4']);
  });

  it('busca o ano uma vez e reutiliza o cache', async () => {
    const f = fakeFetch([{ status: 200, body: fixture }]);
    const s = new SaintsService(client(f));
    await Promise.all([s.getDay('2024-10-15', 'GENERAL', 'la'), s.getDay('2024-10-16', 'GENERAL', 'la')]);
    await s.getDay('2024-10-17', 'GENERAL', 'la');
    expect(f.calls).toHaveLength(1);
  });

  it('falha do provedor vira erro tratado, sem santos inventados', async () => {
    const s = new SaintsService(client(fakeFetch([{ status: 503 }])));
    expect((await s.getDay('2024-10-16', 'GENERAL', 'la')).status).toBe('error');
  });
});
