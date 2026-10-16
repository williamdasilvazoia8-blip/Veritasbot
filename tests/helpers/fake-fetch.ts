import type { FetchLike } from '../../src/modules/liturgy/providers/liturgia-diaria/http.js';

export type FakeResponse = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** fetch falso que devolve respostas em sequência e registra as URLs chamadas. */
export function fakeFetch(responses: FakeResponse[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export const noSleep = async () => undefined;
