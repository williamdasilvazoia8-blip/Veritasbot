export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LiturgyProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      'timeout' | 'network' | 'http' | 'too-large' | 'invalid-json' | 'invalid-schema' | 'date-mismatch',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LiturgyProviderError';
  }
}

export interface HttpOptions {
  fetch?: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  headers?: Record<string, string>;
}

export type HttpResult = { status: 404; body: unknown } | { status: 200; body: unknown };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET JSON com timeout, limite de tamanho e novas tentativas limitadas para
 * 429/5xx/erros de rede (backoff exponencial com jitter; respeita Retry-After).
 * 404 é resultado válido (liturgia não encontrada) e nunca é repetido.
 */
export async function getJson(url: string, opts: HttpOptions, signal?: AbortSignal): Promise<HttpResult> {
  const fetchFn = opts.fetch ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let lastError: LiturgyProviderError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfterMs: number | undefined;
    try {
      const timeout = AbortSignal.timeout(opts.timeoutMs);
      const res = await fetchFn(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'VeritasBot (Discord; +https://github.com/williamdasilvazoia8-blip/veritasbot)',
          ...opts.headers,
        },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (res.status === 404)
        return { status: 404, body: await readJson(res, opts.maxBytes).catch(() => null) };
      if (res.status === 200) return { status: 200, body: await readJson(res, opts.maxBytes) };
      lastError = new LiturgyProviderError(`HTTP ${res.status}`, 'http', res.status);
      await res.body?.cancel().catch(() => undefined);
      if (res.status !== 429 && res.status < 500) throw lastError;
      retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof LiturgyProviderError) {
        if (err.kind !== 'http' || (err.status !== 429 && (err.status ?? 0) < 500)) throw err;
        lastError = err;
      } else if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        lastError = new LiturgyProviderError('Tempo esgotado ao consultar a liturgia', 'timeout');
      } else {
        lastError = new LiturgyProviderError(`Falha de rede: ${(err as Error).message}`, 'network');
      }
    }
    if (attempt < maxAttempts) {
      const backoff = (opts.baseDelayMs ?? 500) * 2 ** (attempt - 1);
      const delayMs = Math.min(
        retryAfterMs ?? backoff + Math.floor(random() * backoff),
        opts.maxRetryAfterMs ?? 10_000,
      );
      opts.onRetry?.({ attempt, delayMs, reason: lastError.message });
      await sleep(delayMs);
    }
  }
  throw lastError ?? new LiturgyProviderError('Falha desconhecida', 'network');
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

async function readJson(res: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new LiturgyProviderError('Resposta grande demais', 'too-large');
  const reader = res.body?.getReader();
  if (!reader) return JSON.parse(await res.text());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new LiturgyProviderError('Resposta grande demais', 'too-large');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new LiturgyProviderError('JSON inválido', 'invalid-json');
  }
}

/** "2026-03-20" → { dia: "20", mes: "03", ano: "2026" } */
export function dateQuery(isoDate: string): URLSearchParams {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new RangeError(`Data ISO inválida: ${isoDate}`);
  return new URLSearchParams({ dia: m[3]!, mes: m[2]!, ano: m[1]! });
}

/** "20/03/2024" → "2024-03-20" */
export function brDateToIso(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}
