export type LiturgyLocale = 'pt-BR' | 'pt-PT';
export type LiturgyApiVersion = 'v2' | 'v3';

export interface ReadingOption {
  reference?: string;
  title?: string;
  refrain?: string;
  text: string;
}

export interface Reading {
  order: number;
  /** 'leitura' | 'salmo' | 'evangelho' | 'extra' (vocabulário do provedor). */
  type: string;
  label: string;
  options: ReadingOption[];
}

export interface Prayers {
  collect?: string;
  offerings?: string;
  communion?: string;
  extras: Array<{ title: string; text: string }>;
}

export interface Antiphons {
  entrance?: string;
  communion?: string;
}

export interface LiturgicalCelebration {
  id: string;
  name: string;
  isPrimary: boolean;
  /** Cor como o provedor informou (ex.: "Verde"); null se ausente. */
  color: string | null;
  prayers: Prayers;
  antiphons: Antiphons;
  readings: Reading[];
}

export interface LiturgicalDay {
  /** Data civil local, ISO YYYY-MM-DD. */
  date: string;
  source: 'dancrf-liturgia-diaria';
  sourceVersion: LiturgyApiVersion;
  celebrations: LiturgicalCelebration[];
}

export interface LiturgyProvider {
  readonly version: LiturgyApiVersion;
  /** null = o provedor não tem liturgia para a data (HTTP 404). Erros de rede lançam LiturgyProviderError. */
  getDay(date: string, locale: LiturgyLocale, signal?: AbortSignal): Promise<LiturgicalDay | null>;
}

export function primaryCelebration(day: LiturgicalDay): LiturgicalCelebration | undefined {
  return day.celebrations.find((c) => c.isPrimary) ?? day.celebrations[0];
}

export const LITURGY_ATTRIBUTION = 'Liturgia Diária (Dancrf) · github.com/Dancrf/liturgia-diaria';
export const LITURGY_SOURCE_URL = 'https://github.com/Dancrf/liturgia-diaria';
