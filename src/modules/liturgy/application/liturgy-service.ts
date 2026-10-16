import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../../../shared/logger.js';
import { addDays } from '../../../shared/dates.js';
import {
  primaryCelebration,
  type LiturgicalDay,
  type LiturgyApiVersion,
  type LiturgyLocale,
  type LiturgyProvider,
} from '../domain/types.js';
import { LiturgyProviderError } from '../providers/liturgia-diaria/http.js';
import { TtlCache } from './liturgy-cache.js';

export type LiturgyResult =
  | { status: 'ok'; day: LiturgicalDay; cached: boolean }
  | { status: 'not-found'; date: string }
  | { status: 'error'; date: string; kind: LiturgyProviderError['kind'] | 'unknown'; message: string };

export interface LiturgyServiceOptions {
  providers: Partial<Record<LiturgyApiVersion, LiturgyProvider>>;
  defaultVersion: LiturgyApiVersion;
  v3Enabled: boolean;
  prisma?: PrismaClient;
  logger?: Logger;
  now?: () => number;
  ttl?: { pastMs: number; currentMs: number; notFoundMs: number };
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
      return cached ? { status: 'ok', day: cached, cached: true } : { status: 'not-found', date: isoDate };

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
      const day = await provider.getDay(isoDate, locale);
      if (!day) {
        this.cache.set(key, null, this.ttl.notFoundMs);
        return { status: 'not-found', date: isoDate };
      }
      const today = new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
      this.cache.set(key, day, isoDate < addDays(today, -1) ? this.ttl.pastMs : this.ttl.currentMs);
      await this.saveSummary(day).catch((err) =>
        this.opts.logger?.warn({ err }, 'Falha ao salvar resumo litúrgico'),
      );
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
  if (result.status === 'not-found')
    return 'Liturgia não encontrada para esta data no provedor Liturgia Diária. Nenhum conteúdo foi inventado.';
  if (result.kind === 'timeout')
    return 'O serviço Liturgia Diária não respondeu a tempo. Tente novamente em instantes.';
  if (result.kind === 'invalid-schema' || result.kind === 'invalid-json')
    return 'O serviço Liturgia Diária respondeu em formato inesperado; nada foi exibido para evitar informação incorreta.';
  if (result.kind === 'date-mismatch')
    return 'O serviço Liturgia Diária devolveu outra data; a resposta foi descartada.';
  return 'O serviço Liturgia Diária está indisponível no momento. Tente novamente mais tarde.';
}
