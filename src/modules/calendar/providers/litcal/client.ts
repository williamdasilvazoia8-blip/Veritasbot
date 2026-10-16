import {
  getJson,
  LiturgyProviderError,
  type HttpOptions,
} from '../../../liturgy/providers/liturgia-diaria/http.js';
import { litcalResponseSchema, type LitcalEvent } from './schema.js';

/** Calendários nacionais disponíveis no LitCal (verificado no OpenAPI do projeto). Brasil e Portugal ainda não existem. */
export const LITCAL_CALENDARS = ['GENERAL', 'CA', 'HR', 'IT', 'NL', 'US'] as const;
/** Idiomas oficiais do Calendário Romano Geral no LitCal. Não há português. */
export const LITCAL_LOCALES = ['la', 'en', 'it', 'fr', 'nl'] as const;

export type LitcalCalendarId = (typeof LITCAL_CALENDARS)[number];
export type LitcalLocale = (typeof LITCAL_LOCALES)[number];

export interface LitcalClientOptions extends HttpOptions {
  /** Ex.: https://litcal.johnromanodorazio.com/api/v5 */
  baseUrl: string;
}

/**
 * Cliente do Liturgical Calendar API. Busca o ANO CIVIL inteiro de uma vez
 * (year_type=CIVIL; o padrão do API é o ano litúrgico, que começa no Advento).
 */
export class LitcalClient {
  constructor(private readonly opts: LitcalClientOptions) {}

  async getYear(
    year: number,
    calendar: LitcalCalendarId,
    locale: LitcalLocale,
    signal?: AbortSignal,
    /** Parâmetros do LitCal, ex.: { epiphany: 'SUNDAY_JAN2_JAN8', ascension: 'SUNDAY' }. */
    settings: Record<string, string> = {},
  ): Promise<LitcalEvent[]> {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const path = calendar === 'GENERAL' ? `/calendar/${year}` : `/calendar/nation/${calendar}/${year}`;
    const res = await getJson(
      `${base}${path}?${new URLSearchParams({ year_type: 'CIVIL', ...settings })}`,
      { ...this.opts, headers: { ...this.opts.headers, 'accept-language': locale } },
      signal,
    );
    if (res.status === 404)
      throw new LiturgyProviderError('Calendário não encontrado no LitCal', 'http', 404);
    const parsed = litcalResponseSchema.safeParse(res.body);
    if (!parsed.success)
      throw new LiturgyProviderError(
        `Resposta do LitCal fora do formato: ${parsed.error.issues[0]?.message ?? ''}`,
        'invalid-schema',
      );
    return parsed.data.litcal;
  }
}
