import type { Logger } from '../../../shared/logger.js';
import { addDays } from '../../../shared/dates.js';
import type { LitcalEvent } from '../../calendar/providers/litcal/schema.js';
import { describeDay } from '../../calendar/rules/general-roman-calendar.js';
import { brazilDay, brazilSanctoral, LITCAL_BRAZIL_SETTINGS, type BrazilDay } from './brazil-day.js';

/**
 * Leituras para datas que o Liturgia Diária não tem (o serviço só cobre alguns anos).
 *
 * As leituras da Missa repetem-se: dependem da celebração do dia, do ciclo dominical
 * (A/B/C) e do ano par/ímpar (I/II). Calculamos essa identidade para a data pedida e
 * procuramos, dentro dos anos que o serviço cobre, uma data com a mesma identidade; o
 * texto apresentado é o do serviço para essa data — nada é composto nem inventado — e a
 * resposta indica sempre de que data vieram os textos.
 *
 * Validado contra o próprio serviço (2024-2027): datas com a mesma chave têm as mesmas
 * leituras em ~97% dos casos; as diferenças restantes são incoerências da fonte.
 */

export interface LitcalYearSource {
  getYear(
    year: number,
    calendar: 'GENERAL',
    locale: 'en',
    signal?: AbortSignal,
    settings?: Record<string, string>,
  ): Promise<LitcalEvent[]>;
}

/** Anos cobertos pelo Liturgia Diária (verificado em 2026-10-16). */
export const DEFAULT_REFERENCE_WINDOW = { start: '2024-01-01', end: '2027-12-31' } as const;
/** O Lecionário atual (ciclos A/B/C e I/II) começou em 1969-1970; o LitCal vai até 9999. */
export const MIN_EQUIVALENCE_YEAR = 1970;
export const MAX_EQUIVALENCE_YEAR = 9999;

export interface EquivalenceCandidate {
  date: string;
  /** Mesma celebração (título, cor e orações também servem). */
  sameCelebration: boolean;
  /** Encontrada pela chave mais específica (mesmo ciclo). */
  exact: boolean;
}

export interface EquivalencePlan {
  target: BrazilDay;
  /** Datas do serviço com as mesmas leituras, da melhor para a pior. */
  readings: EquivalenceCandidate[];
  /** Datas do serviço com a mesma celebração (para título, cor e orações). */
  celebration: string[];
  /** Título em português quando nenhuma data tem a mesma celebração. */
  fallbackName: string;
  /** Cor (como o serviço a escreve) segundo o LitCal. */
  fallbackColor: string | null;
}

interface YearData {
  sanctoral: Map<string, LitcalEvent[]>;
  events: LitcalEvent[];
}

interface WindowIndex {
  byReadings: Map<string, string[]>;
  byCelebration: Map<string, string[]>;
  days: Map<string, BrazilDay>;
}

const COLOR_PT: Record<string, string> = {
  green: 'Verde',
  white: 'Branco',
  red: 'Vermelho',
  purple: 'Roxo',
  rose: 'Rosa',
  pink: 'Rosa',
};

export class LiturgyEquivalenceService {
  private readonly years = new Map<number, Promise<YearData>>();
  private index?: Promise<WindowIndex>;
  private readonly window: { start: string; end: string };

  constructor(
    private readonly litcal: LitcalYearSource,
    private readonly opts: {
      window?: { start: string; end: string };
      logger?: Logger;
      maxCachedYears?: number;
    } = {},
  ) {
    this.window = opts.window ?? DEFAULT_REFERENCE_WINDOW;
  }

  supports(isoDate: string): boolean {
    const year = Number(isoDate.slice(0, 4));
    return year >= MIN_EQUIVALENCE_YEAR && year <= MAX_EQUIVALENCE_YEAR;
  }

  /** null = data fora do alcance (antes de 1970) ou sem nenhuma data equivalente. */
  async plan(isoDate: string): Promise<EquivalencePlan | null> {
    if (!this.supports(isoDate)) return null;
    const [index, year] = await Promise.all([this.getIndex(), this.getYear(Number(isoDate.slice(0, 4)))]);
    const target = brazilDay(isoDate, year.sanctoral);

    const readings: EquivalenceCandidate[] = [];
    const seen = new Set<string>([isoDate]);
    target.readingsKeys.forEach((key, i) => {
      const dates = (index.byReadings.get(key) ?? []).filter((d) => !seen.has(d));
      const rank = (d: string) => {
        const day = index.days.get(d)!;
        return (day.celebrationKey === target.celebrationKey ? 0 : 2) + (day.sanctoral ? 1 : 0);
      };
      for (const date of dates.sort((a, b) => rank(a) - rank(b))) {
        seen.add(date);
        readings.push({
          date,
          sameCelebration: index.days.get(date)!.celebrationKey === target.celebrationKey,
          exact: i === 0,
        });
      }
    });
    if (readings.length === 0) return null;

    return {
      target,
      readings,
      celebration: (index.byCelebration.get(target.celebrationKey) ?? []).filter((d) => d !== isoDate),
      fallbackName: this.fallbackName(target, year.events),
      fallbackColor: this.colorFor(target, year.events),
    };
  }

  private fallbackName(target: BrazilDay, events: LitcalEvent[]): string {
    const temporal = describeDay(target.date, {
      epiphanyOnSunday: true,
      ascensionOnSunday: true,
    }).description;
    const label = temporal.charAt(0).toUpperCase() + temporal.slice(1);
    if (!target.sanctoral || target.sanctoral.grade < 3) return label;
    const saint = events.find((e) => e.event_key === target.sanctoral!.key);
    // O LitCal não tem nomes em português; o nome vem em inglês, identificado como tal.
    return saint && saint.name !== saint.event_key
      ? `${saint.name} (nome do Calendário Romano) — ${label}`
      : label;
  }

  private colorFor(target: BrazilDay, events: LitcalEvent[]): string | null {
    const sameDay = events.filter((e) => isoOf(e) === target.date && !e.is_vigil_mass);
    const e =
      (target.sanctoral && sameDay.find((x) => x.event_key === target.sanctoral!.key)) ??
      sameDay.find((x) => x.type === 'mobile') ??
      null;
    const c = e?.color[0];
    return c ? (COLOR_PT[c] ?? null) : null;
  }

  private getYear(year: number): Promise<YearData> {
    let p = this.years.get(year);
    if (!p) {
      p = this.litcal
        .getYear(year, 'GENERAL', 'en', undefined, { ...LITCAL_BRAZIL_SETTINGS })
        .then((events) => ({ events, sanctoral: brazilSanctoral(year, events) }));
      p.catch(() => this.years.delete(year));
      this.years.set(year, p);
      const max = this.opts.maxCachedYears ?? 12;
      if (this.years.size > max) {
        const windowYears = this.windowYears();
        const evict = [...this.years.keys()].find((y) => !windowYears.includes(y));
        if (evict !== undefined) this.years.delete(evict);
      }
    }
    return p;
  }

  private windowYears(): number[] {
    const out: number[] = [];
    for (let y = Number(this.window.start.slice(0, 4)); y <= Number(this.window.end.slice(0, 4)); y++)
      out.push(y);
    return out;
  }

  private getIndex(): Promise<WindowIndex> {
    if (!this.index) {
      this.index = this.buildIndex();
      this.index.catch(() => (this.index = undefined));
    }
    return this.index;
  }

  private async buildIndex(): Promise<WindowIndex> {
    const index: WindowIndex = { byReadings: new Map(), byCelebration: new Map(), days: new Map() };
    const push = (map: Map<string, string[]>, key: string, date: string) =>
      map.set(key, [...(map.get(key) ?? []), date]);
    for (const year of this.windowYears()) {
      const { sanctoral } = await this.getYear(year);
      const from = year === Number(this.window.start.slice(0, 4)) ? this.window.start : `${year}-01-01`;
      const to = year === Number(this.window.end.slice(0, 4)) ? this.window.end : `${year}-12-31`;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = brazilDay(d, sanctoral);
        index.days.set(d, day);
        for (const key of day.readingsKeys) push(index.byReadings, key, d);
        push(index.byCelebration, day.celebrationKey, d);
      }
    }
    this.opts.logger?.info({ days: index.days.size }, 'Índice de equivalência litúrgica pronto');
    return index;
  }
}

function isoOf(e: LitcalEvent): string {
  return `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
}
