import { describe, expect, it } from 'vitest';
import {
  brDateToIso,
  dateQuery,
  getJson,
  LiturgyProviderError,
} from '../../../src/modules/liturgy/providers/liturgia-diaria/http.js';
import { fakeFetch } from '../../helpers/fake-fetch.js';

const base = { timeoutMs: 1000, maxBytes: 100_000, baseDelayMs: 10, random: () => 0 };

describe('getJson', () => {
  it('repete em 503 e devolve o sucesso seguinte', async () => {
    const delays: number[] = [];
    const f = fakeFetch([{ status: 503 }, { status: 200, body: { ok: 1 } }]);
    const r = await getJson('https://x/v2/', {
      ...base,
      fetch: f,
      sleep: async (ms) => void delays.push(ms),
    });
    expect(r).toEqual({ status: 200, body: { ok: 1 } });
    expect(f.calls).toHaveLength(2);
    expect(delays).toEqual([10]);
  });

  it('respeita Retry-After em 429 (com teto)', async () => {
    const delays: number[] = [];
    const f = fakeFetch([
      { status: 429, headers: { 'retry-after': '3' } },
      { status: 200, body: {} },
    ]);
    await getJson('https://x', {
      ...base,
      fetch: f,
      sleep: async (ms) => void delays.push(ms),
      maxRetryAfterMs: 2000,
    });
    expect(delays).toEqual([2000]);
  });

  it('404 é resultado válido e nunca é repetido', async () => {
    const f = fakeFetch([{ status: 404, body: { erro: 'Não encontramos nenhuma liturgia para esta data' } }]);
    const r = await getJson('https://x', { ...base, fetch: f, sleep: async () => undefined });
    expect(r.status).toBe(404);
    expect(f.calls).toHaveLength(1);
  });

  it('número de tentativas é limitado', async () => {
    const f = fakeFetch([{ status: 500 }]);
    await expect(
      getJson('https://x', { ...base, fetch: f, maxAttempts: 3, sleep: async () => undefined }),
    ).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(f.calls).toHaveLength(3);
  });

  it('4xx (exceto 404/429) não é repetido', async () => {
    const f = fakeFetch([{ status: 400 }]);
    await expect(
      getJson('https://x', { ...base, fetch: f, sleep: async () => undefined }),
    ).rejects.toBeInstanceOf(LiturgyProviderError);
    expect(f.calls).toHaveLength(1);
  });

  it('erros de rede viram LiturgyProviderError após as tentativas', async () => {
    const f = fakeFetch([new TypeError('fetch failed')]);
    await expect(
      getJson('https://x', { ...base, fetch: f, maxAttempts: 2, sleep: async () => undefined }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('timeout é tratado como falha transitória', async () => {
    const slow = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
        ),
      )) as never;
    await expect(
      getJson('https://x', { ...base, timeoutMs: 20, fetch: slow, maxAttempts: 1 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('rejeita respostas grandes demais', async () => {
    const f = fakeFetch([{ status: 200, body: { big: 'x'.repeat(5000) } }]);
    await expect(getJson('https://x', { ...base, maxBytes: 1000, fetch: f })).rejects.toMatchObject({
      kind: 'too-large',
    });
  });
});

describe('datas', () => {
  it('monta dia, mês e ano explícitos', () => {
    expect(dateQuery('2024-03-20').toString()).toBe('dia=20&mes=03&ano=2024');
  });
  it('converte DD/MM/AAAA', () => {
    expect(brDateToIso('19/04/2025')).toBe('2025-04-19');
    expect(brDateToIso('lixo')).toBeNull();
  });
});
