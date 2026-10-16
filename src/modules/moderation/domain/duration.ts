import { DateTime, type DurationLikeObject } from 'luxon';

export type DurationUnit = 's' | 'min' | 'h' | 'd' | 'sem' | 'mo' | 'y';

export interface DurationPart {
  value: number;
  unit: DurationUnit;
}

export type ParsedDuration = { ok: true; parts: DurationPart[] } | { ok: false; error: string };

const UNIT_ALIASES: Record<string, DurationUnit> = {
  s: 's',
  seg: 's',
  segundo: 's',
  segundos: 's',
  min: 'min',
  minuto: 'min',
  minutos: 'min',
  h: 'h',
  hora: 'h',
  horas: 'h',
  d: 'd',
  dia: 'd',
  dias: 'd',
  sem: 'sem',
  semana: 'sem',
  semanas: 'sem',
  mo: 'mo',
  mes: 'mo',
  meses: 'mo',
  y: 'y',
  a: 'y',
  ano: 'y',
  anos: 'y',
};

const LUXON_KEY: Record<DurationUnit, keyof DurationLikeObject> = {
  s: 'seconds',
  min: 'minutes',
  h: 'hours',
  d: 'days',
  sem: 'weeks',
  mo: 'months',
  y: 'years',
};

const LABEL: Record<DurationUnit, [string, string]> = {
  s: ['segundo', 'segundos'],
  min: ['minuto', 'minutos'],
  h: ['hora', 'horas'],
  d: ['dia', 'dias'],
  sem: ['semana', 'semanas'],
  mo: ['mês', 'meses'],
  y: ['ano', 'anos'],
};

export const MIN_DURATION_MS = 5_000;
export const MAX_DURATION_YEARS = 10;
/** Limite atual do timeout nativo do Discord (communication_disabled_until). */
export const DISCORD_MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * "30s", "2h", "7d", "1mo", "1y", "1d12h", "2 meses". "m" sozinho é rejeitado
 * (ambíguo entre minutos e meses).
 */
export function parseDuration(input: string): ParsedDuration {
  const text = input.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (!text) return { ok: false, error: 'Informe uma duração, ex.: 30s, 10min, 2h, 7d, 1mo, 1y.' };
  const re = /(\d{1,4})\s*([a-z]+)/gy;
  const parts: DurationPart[] = [];
  let pos = 0;
  for (;;) {
    while (text[pos] === ' ') pos++;
    if (pos >= text.length) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return { ok: false, error: `Não entendi "${input}". Exemplos: 30s, 10min, 2h, 7d, 1mo, 1y.` };
    const [, num, unitRaw] = m;
    if (unitRaw === 'm')
      return { ok: false, error: '"m" é ambíguo: use **min** para minutos ou **mo** para meses.' };
    const unit = UNIT_ALIASES[unitRaw!];
    if (!unit)
      return { ok: false, error: `Unidade desconhecida "${unitRaw}". Use s, min, h, d, sem, mo ou y.` };
    const value = Number(num);
    if (value <= 0) return { ok: false, error: 'A duração deve ser maior que zero.' };
    parts.push({ value, unit });
    pos = re.lastIndex;
  }
  if (parts.length === 0) return { ok: false, error: 'Informe uma duração.' };
  return { ok: true, parts };
}

/**
 * Soma calendário-consciente no fuso informado: 1mo a partir de 31/01 → 28/02 (ou 29/02),
 * 1y a partir de 29/02 → 28/02. Nunca assume 30 dias por mês nem 365 por ano.
 */
export function computeExpiry(parts: DurationPart[], start: Date, timezone: string): Date {
  let dt = DateTime.fromJSDate(start, { zone: timezone });
  // Unidades de calendário primeiro, depois as de relógio (ordem estável e previsível).
  const order: DurationUnit[] = ['y', 'mo', 'sem', 'd', 'h', 'min', 's'];
  for (const unit of order) {
    const total = parts.filter((p) => p.unit === unit).reduce((n, p) => n + p.value, 0);
    if (total > 0) dt = dt.plus({ [LUXON_KEY[unit]]: total });
  }
  return dt.toJSDate();
}

export function describeDuration(parts: DurationPart[]): string {
  return parts.map((p) => `${p.value} ${LABEL[p.unit][p.value === 1 ? 0 : 1]}`).join(' e ');
}

export function validateSpan(start: Date, end: Date): string | null {
  const ms = end.getTime() - start.getTime();
  if (ms < MIN_DURATION_MS) return 'Duração mínima: 5 segundos.';
  if (DateTime.fromJSDate(end) > DateTime.fromJSDate(start).plus({ years: MAX_DURATION_YEARS }))
    return `Duração máxima: ${MAX_DURATION_YEARS} anos.`;
  return null;
}

export type MuteMechanismChoice = 'NATIVE_TIMEOUT' | 'MUTED_ROLE';

/** Timeout nativo só até o limite do Discord; acima disso, cargo de silenciado. */
export function chooseMechanism(start: Date, end: Date): MuteMechanismChoice {
  return end.getTime() - start.getTime() <= DISCORD_MAX_TIMEOUT_MS ? 'NATIVE_TIMEOUT' : 'MUTED_ROLE';
}
