import { DateTime } from 'luxon';

export type RecurrenceKind = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Occurrence {
  /** Instante real de envio (UTC). */
  runAt: Date;
  /** Chave estável: data/hora local NOMINAL "YYYY-MM-DDTHH:mm" (antes de ajustes de horário de verão). */
  key: string;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseLocal(startLocal: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const m = LOCAL_RE.exec(startLocal);
  if (!m) throw new RangeError(`Data/hora local inválida: ${startLocal}`);
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (!DateTime.utc(year, month, day, hour, minute).isValid || hour > 23 || minute > 59)
    throw new RangeError(`Data/hora local inválida: ${startLocal}`);
  return { year, month, day, hour, minute };
}

/**
 * n-ésima ocorrência NOMINAL a partir da âncora. Mensal/anual são calculados
 * sempre a partir da âncora (31/01 → 28/02 → 31/03), nunca encadeados, para não "derivar".
 */
function nominal(startLocal: string, recurrence: RecurrenceKind, n: number): DateTime {
  const s = parseLocal(startLocal);
  const anchor = DateTime.utc(s.year, s.month, s.day, s.hour, s.minute);
  switch (recurrence) {
    case 'ONCE':
      return anchor;
    case 'DAILY':
      return anchor.plus({ days: n });
    case 'WEEKLY':
      return anchor.plus({ weeks: n });
    case 'MONTHLY':
      return anchor.plus({ months: n }); // Luxon ajusta para o último dia do mês quando necessário
    case 'YEARLY':
      return anchor.plus({ years: n }); // 29/02 → 28/02 em anos não bissextos
  }
}

/**
 * Converte data/hora local nominal em instante real no fuso.
 * Política de horário de verão (documentada):
 * - hora inexistente (adiantamento do relógio): avança pelo tamanho do salto (02:30 → 03:30);
 * - hora repetida (atraso do relógio): usa a PRIMEIRA ocorrência (offset anterior).
 */
export function resolveLocal(n: DateTime, timezone: string): DateTime {
  const local = DateTime.fromObject(
    { year: n.year, month: n.month, day: n.day, hour: n.hour, minute: n.minute },
    { zone: timezone },
  );
  // Luxon resolve horas ambíguas pelo offset; força a primeira (offset maior) quando houver duas.
  const earlier = local.minus({ hours: 1 });
  if (
    earlier.hour === local.hour &&
    earlier.minute === local.minute &&
    earlier.day === local.day &&
    earlier.offset !== local.offset
  ) {
    return earlier;
  }
  return local;
}

export function occurrence(
  startLocal: string,
  timezone: string,
  recurrence: RecurrenceKind,
  n: number,
): Occurrence {
  const nom = nominal(startLocal, recurrence, n);
  return { runAt: resolveLocal(nom, timezone).toJSDate(), key: nom.toFormat("yyyy-LL-dd'T'HH:mm") };
}

/** Primeira ocorrência com instante estritamente posterior a `after` (ou null se não houver mais). */
export function nextOccurrence(
  startLocal: string,
  timezone: string,
  recurrence: RecurrenceKind,
  after: Date,
): Occurrence | null {
  const first = occurrence(startLocal, timezone, recurrence, 0);
  if (recurrence === 'ONCE') return first.runAt > after ? first : null;
  if (first.runAt > after) return first;
  const approxDays = (after.getTime() - first.runAt.getTime()) / 86_400_000;
  // Estimativa por BAIXO (meses de 31 dias, anos de 366) e avanço até passar de `after`.
  const per = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[recurrence];
  let n = Math.max(0, Math.floor(approxDays / per) - 2);
  for (let guard = 0; guard < 1000; guard++, n++) {
    const occ = occurrence(startLocal, timezone, recurrence, n);
    if (occ.runAt > after) return occ;
  }
  return null;
}

export const RECURRENCE_LABEL: Record<RecurrenceKind, string> = {
  ONCE: 'uma vez',
  DAILY: 'diária',
  WEEKLY: 'semanal',
  MONTHLY: 'mensal',
  YEARLY: 'anual',
};
