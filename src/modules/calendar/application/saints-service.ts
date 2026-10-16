import type { Logger } from '../../../shared/logger.js';
import { TtlCache } from '../../liturgy/application/liturgy-cache.js';
import { LiturgyProviderError } from '../../liturgy/providers/liturgia-diaria/http.js';
import type { LitcalCalendarId, LitcalClient, LitcalLocale } from '../providers/litcal/client.js';
import type { LitcalEvent } from '../providers/litcal/schema.js';

export interface DayCelebration {
  key: string;
  name: string;
  grade: number;
  gradeLabel: string;
  colors: string[];
  holyDayOfObligation: boolean;
}

export type SaintsResult =
  | {
      status: 'ok';
      date: string;
      calendar: LitcalCalendarId;
      locale: LitcalLocale;
      celebrations: DayCelebration[];
    }
  | { status: 'error'; date: string; message: string };

export const GRADE = {
  WEEKDAY: 0,
  COMMEMORATION: 1,
  MEMORIAL_OPT: 2,
  MEMORIAL: 3,
  FEAST: 4,
  FEAST_LORD: 5,
  SOLEMNITY: 6,
  HIGHER_SOLEMNITY: 7,
} as const;

/**
 * "Santos do dia" pelo Calendário Romano (LitCal). Seleciona os eventos pela data
 * civil (campos year/month/day do provedor), exclui Missas de vigília (pertencem
 * à véspera litúrgica do dia seguinte) e ordena por grau.
 */
export class SaintsService {
  private readonly cache: TtlCache<LitcalEvent[]>;
  private readonly inflight = new Map<string, Promise<LitcalEvent[]>>();

  constructor(
    private readonly client: LitcalClient,
    private readonly opts: { logger?: Logger; ttlMs?: number; now?: () => number } = {},
  ) {
    this.cache = new TtlCache(24, opts.now);
  }

  async getDay(
    isoDate: string,
    calendar: LitcalCalendarId,
    locale: LitcalLocale,
    opts: { includeOptional?: boolean; includeWeekdays?: boolean } = {},
  ): Promise<SaintsResult> {
    const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
    try {
      const events = await this.year(y, calendar, locale);
      const celebrations = events
        .filter((e) => e.year === y && e.month === m && e.day === d && !e.is_vigil_mass)
        .filter((e) => (opts.includeWeekdays ? true : e.grade > GRADE.WEEKDAY))
        .filter((e) => (opts.includeOptional === false ? e.grade !== GRADE.MEMORIAL_OPT : true))
        .sort((a, b) => b.grade - a.grade)
        .map((e) => ({
          key: e.event_key,
          name: e.name,
          grade: e.grade,
          gradeLabel: e.grade_display || e.grade_lcl || String(e.grade),
          colors: e.color_lcl?.length ? e.color_lcl : e.color,
          holyDayOfObligation: Boolean(e.holy_day_of_obligation),
        }));
      return { status: 'ok', date: isoDate, calendar, locale, celebrations };
    } catch (err) {
      const message =
        err instanceof LiturgyProviderError ? `${err.kind}: ${err.message}` : (err as Error).message;
      this.opts.logger?.warn({ date: isoDate, calendar, err: message }, 'Falha no LitCal');
      return { status: 'error', date: isoDate, message };
    }
  }

  private year(year: number, calendar: LitcalCalendarId, locale: LitcalLocale): Promise<LitcalEvent[]> {
    const key = `${calendar}:${locale}:${year}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.client
      .getYear(year, calendar, locale)
      .then((events) => {
        this.cache.set(key, events, this.opts.ttlMs ?? 24 * 3_600_000);
        return events;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
