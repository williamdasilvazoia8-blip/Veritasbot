import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../../../shared/logger.js';
import { addDays } from '../../../shared/dates.js';
import {
  primaryCelebration,
  type LiturgicalCelebration,
  type LiturgicalDay,
  type LiturgyApiVersion,
  type LiturgyLocale,
  type LiturgyProvider,
} from '../domain/types.js';
import { LiturgyProviderError } from '../providers/liturgia-diaria/http.js';
import { TtlCache } from './liturgy-cache.js';
import type { LiturgyEquivalenceService } from '../equivalence/equivalence-service.js';
import { isBefore1970, PRE_1970_MESSAGE } from '../../calendar/rules/pre-1970.js';

export type LiturgyResult =
  | { status: 'ok'; day: LiturgicalDay; cached: boolean }
  | {
      status: 'not-found';
      date: string;
      /** Por que não houve data equivalente (só quando o serviço não tinha a data). */
      reason?: 'before-1970' | 'no-equivalent';
    }
  | { status: 'error'; date: string; kind: LiturgyProviderError['kind'] | 'unknown'; message: string };

export interface LiturgyServiceOptions {
  providers: Partial<Record<LiturgyApiVersion, LiturgyProvider>>;
  defaultVersion: LiturgyApiVersion;
  v3Enabled: boolean;
  prisma?: PrismaClient;
  logger?: Logger;
  now?: () => number;
  ttl?: { pastMs: number; currentMs: number; notFoundMs: number };
  /** Datas que o serviço não tem: usa a data equivalente (mesma celebração e ciclos). */
  equivalence?: LiturgyEquivalenceService;
}

const HOUR = 3_600_000;

export class LiturgyService {
  private readonly cache: TtlCache<LiturgicalDay | null>;
  private readonly inflight = new Map<string, Promise<LiturgyResult>>();
  private readonly ttl: NonNullable<LiturgyServiceOptions['ttl']>;

  constructor(private readonly opts: LiturgyServiceOptions) {
    this.cache = new TtlCache(400, opts.now);
    this.ttl = opts.ttl ?? { pastMs: 24 * HOUR, currentMs: 6 * HOUR, notFoundMs: 1 * HOUR };
  }

  /** Versão efetiva: v3 só se a flag global permitir; caso contrário, v2. */
  resolveVersion(requested?: string | null): LiturgyApiVersion {
    if (requested === 'v3' && this.opts.v3Enabled && this.opts.providers.v3) return 'v3';
    return this.opts.providers[this.opts.defaultVersion] ? this.opts.defaultVersion : 'v2';
  }

  async getDay(
    isoDate: string,
    version: LiturgyApiVersion,
    locale: LiturgyLocale = 'pt-BR',
  ): Promise<LiturgyResult> {
    if (isBefore1970(isoDate)) return { status: 'not-found', date: isoDate, reason: 'before-1970' };
    const provider = this.opts.providers[version];
    if (!provider)
      return {
        status: 'error',
        date: isoDate,
        kind: 'unknown',
        message: `Provedor ${version} não configurado`,
      };
    const key = `dancrf:${version}:${locale}:${isoDate}`;
    const cached = this.cache.get(key);
    if (cached !== undefined)
      return cached
        ? { status: 'ok', day: cached, cached: true }
        : { status: 'not-found', date: isoDate, ...this.notFoundReason(isoDate) };

    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.fetchAndCache(provider, key, isoDate, locale).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fetchAndCache(
    provider: LiturgyProvider,
    key: string,
    isoDate: string,
    locale: LiturgyLocale,
  ): Promise<LiturgyResult> {
    try {
      const exact = await this.fetchExact(provider, isoDate, locale);
      const day = exact ?? (await this.fromEquivalentDate(provider, isoDate, locale));
      if (!day) {
        this.cache.set(key, null, this.ttl.notFoundMs);
        return { status: 'not-found', date: isoDate, ...this.notFoundReason(isoDate) };
      }
      this.cache.set(key, day, this.ttlFor(isoDate));
      return { status: 'ok', day, cached: false };
    } catch (err) {
      const e = err instanceof LiturgyProviderError ? err : undefined;
      this.opts.logger?.warn(
        { date: isoDate, version: provider.version, kind: e?.kind, err: (err as Error).message },
        'Falha no provedor de liturgia',
      );
      return { status: 'error', date: isoDate, kind: e?.kind ?? 'unknown', message: (err as Error).message };
    }
  }

  private notFoundReason(isoDate: string): { reason?: 'no-equivalent' } {
    return this.opts.equivalence?.supports(isoDate) ? { reason: 'no-equivalent' } : {};
  }

  private ttlFor(isoDate: string): number {
    const today = new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
    return isoDate < addDays(today, -1) ? this.ttl.pastMs : this.ttl.currentMs;
  }

  /** O dia exatamente como o serviço o tem (com cache próprio), sem equivalências. */
  private async fetchExact(
    provider: LiturgyProvider,
    isoDate: string,
    locale: LiturgyLocale,
  ): Promise<LiturgicalDay | null> {
    const key = `exact:${provider.version}:${locale}:${isoDate}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const day = await provider.getDay(isoDate, locale);
    this.cache.set(key, day, day ? this.ttlFor(isoDate) : this.ttl.notFoundMs);
    if (day)
      await this.saveSummary(day).catch((err) =>
        this.opts.logger?.warn({ err }, 'Falha ao salvar resumo litúrgico'),
      );
    return day;
  }

  /**
   * O serviço não tem a data: procura outra data do serviço com a mesma celebração e os
   * mesmos ciclos. As leituras vêm dessa data; título, cor e orações vêm de uma data com
   * a mesma celebração (ou são calculados/omitidos). O resultado diz sempre a origem.
   */
  private async fromEquivalentDate(
    provider: LiturgyProvider,
    isoDate: string,
    locale: LiturgyLocale,
  ): Promise<LiturgicalDay | null> {
    const equivalence = this.opts.equivalence;
    if (!equivalence?.supports(isoDate)) return null;
    let plan;
    try {
      plan = await equivalence.plan(isoDate);
    } catch (err) {
      this.opts.logger?.warn({ err, date: isoDate }, 'Falha ao calcular a data equivalente');
      return null;
    }
    if (!plan) return null;

    let readingsDay: LiturgicalDay | null = null;
    let candidate: (typeof plan.readings)[number] | undefined;
    for (const c of plan.readings.slice(0, 3)) {
      readingsDay = await this.fetchExact(provider, c.date, locale);
      if (readingsDay) {
        candidate = c;
        break;
      }
    }
    if (!readingsDay || !candidate) return null;
    const equivalent = {
      readingsDate: candidate.date,
      celebrationDate: candidate.sameCelebration ? candidate.date : null,
      exact: candidate.exact,
    };
    // Mesma celebração: o dia do serviço serve inteiro (inclui várias Missas, ex.: Natal).
    if (candidate.sameCelebration) return { ...readingsDay, date: isoDate, equivalent };

    const readings = primaryCelebration(readingsDay)?.readings ?? [];
    let celebrationDay: LiturgicalDay | null = null;
    for (const d of plan.celebration.slice(0, 2)) {
      celebrationDay = await this.fetchExact(provider, d, locale);
      if (celebrationDay) {
        equivalent.celebrationDate = d;
        break;
      }
    }
    const base = celebrationDay ? primaryCelebration(celebrationDay) : undefined;
    const celebration: LiturgicalCelebration = base
      ? { ...base, isPrimary: true, readings }
      : {
          id: `equivalente-${isoDate}`,
          name: plan.fallbackName,
          isPrimary: true,
          color: plan.fallbackColor,
          prayers: { extras: [] },
          antiphons: {},
          readings,
        };
    return {
      date: isoDate,
      source: readingsDay.source,
      sourceVersion: readingsDay.sourceVersion,
      celebrations: [celebration],
      equivalent,
    };
  }

  /** Busca dias explicitamente datados com concorrência limitada (não usa `periodo`, que parte da data do servidor). */
  async getRange(
    startIso: string,
    days: number,
    version: LiturgyApiVersion,
    locale: LiturgyLocale = 'pt-BR',
    concurrency = 2,
  ): Promise<LiturgyResult[]> {
    const dates = Array.from({ length: days }, (_, i) => addDays(startIso, i));
    const results: LiturgyResult[] = new Array(dates.length);
    let next = 0;
    const worker = async () => {
      while (next < dates.length) {
        const i = next++;
        results[i] = await this.getDay(dates[i]!, version, locale);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, dates.length) }, worker));
    return results;
  }

  /** Persiste apenas metadados (nome, cor, hash) — nunca os textos. */
  private async saveSummary(day: LiturgicalDay): Promise<void> {
    if (!this.opts.prisma) return;
    const c = primaryCelebration(day);
    if (!c) return;
    const payloadHash = createHash('sha256').update(JSON.stringify(day)).digest('hex');
    const data = {
      celebrationName: c.name,
      color: c.color,
      payloadHash,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    };
    await this.opts.prisma.liturgyDaySummary.upsert({
      where: { source_version_date: { source: day.source, version: day.sourceVersion, date: day.date } },
      update: data,
      create: { source: day.source, version: day.sourceVersion, date: day.date, ...data },
    });
  }
}

export function describeLiturgyFailure(result: Exclude<LiturgyResult, { status: 'ok' }>): string {
  if (result.status === 'not-found') {
    if (result.reason === 'before-1970') return PRE_1970_MESSAGE;
    if (result.reason === 'no-equivalent')
      return 'O Liturgia Diária não tem esta data e, nos anos que ele cobre, não há nenhum dia com a mesma celebração e o mesmo ciclo (acontece com alguns domingos e semanas do Tempo Comum). Nenhum conteúdo foi inventado.';
    return 'Liturgia não encontrada para esta data no provedor Liturgia Diária. Nenhum conteúdo foi inventado.';
  }
  if (result.kind === 'timeout')
    return 'O serviço Liturgia Diária não respondeu a tempo. Tente novamente em instantes.';
  if (result.kind === 'invalid-schema' || result.kind === 'invalid-json')
    return 'O serviço Liturgia Diária respondeu em formato inesperado; nada foi exibido para evitar informação incorreta.';
  if (result.kind === 'date-mismatch')
    return 'O serviço Liturgia Diária devolveu outra data; a resposta foi descartada.';
  return 'O serviço Liturgia Diária está indisponível no momento. Tente novamente mais tarde.';
}
