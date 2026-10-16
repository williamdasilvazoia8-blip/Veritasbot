import type { z } from 'zod';
import type { LiturgicalDay, LiturgyApiVersion, LiturgyLocale, LiturgyProvider } from '../../domain/types.js';
import { brDateToIso, dateQuery, getJson, LiturgyProviderError, type HttpOptions } from './http.js';
import { v2DaySchema } from './v2/schema.js';
import { normalizeV2 } from './v2/normalize.js';
import { v3DaySchema } from './v3/schema.js';
import { normalizeV3 } from './v3/normalize.js';

export interface LiturgiaDiariaClientOptions extends HttpOptions {
  baseUrl: string;
}

abstract class BaseClient<S extends z.ZodTypeAny> implements LiturgyProvider {
  abstract readonly version: LiturgyApiVersion;
  protected abstract readonly schema: S;
  protected abstract normalize(raw: z.infer<S>, isoDate: string): LiturgicalDay;

  constructor(protected readonly opts: LiturgiaDiariaClientOptions) {}

  /** Sempre consulta com dia, mês E ano explícitos: nunca depende da data do servidor remoto. */
  async getDay(isoDate: string, _locale: LiturgyLocale, signal?: AbortSignal): Promise<LiturgicalDay | null> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/${this.version}/?${dateQuery(isoDate).toString()}`;
    const res = await getJson(url, this.opts, signal);
    if (res.status === 404) return null;
    const parsed = this.schema.safeParse(res.body);
    if (!parsed.success) {
      throw new LiturgyProviderError(
        `Resposta ${this.version} fora do formato esperado: ${parsed.error.issues[0]?.message ?? ''}`,
        'invalid-schema',
      );
    }
    const returned = brDateToIso((parsed.data as { data: string }).data);
    if (returned !== isoDate) {
      // Nunca exibimos a liturgia de outra data como se fosse a pedida.
      throw new LiturgyProviderError(`Provedor devolveu ${returned ?? '?'} para ${isoDate}`, 'date-mismatch');
    }
    return this.normalize(parsed.data, isoDate);
  }
}

export class LiturgiaDiariaV2Client extends BaseClient<typeof v2DaySchema> {
  readonly version = 'v2' as const;
  protected readonly schema = v2DaySchema;
  protected normalize = normalizeV2;
}

/** BETA: só deve ser usado com LITURGIA_V3_ENABLED=true. */
export class LiturgiaDiariaV3Client extends BaseClient<typeof v3DaySchema> {
  readonly version = 'v3' as const;
  protected readonly schema = v3DaySchema;
  protected normalize = normalizeV3;
}
