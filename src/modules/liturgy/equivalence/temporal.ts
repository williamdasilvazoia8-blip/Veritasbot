import { DateTime } from 'luxon';
import { easterSunday } from '../../calendar/rules/computus.js';

/**
 * Ciclo temporal (Próprio do Tempo) para QUALQUER ano, com as regras do Brasil:
 * Epifania no domingo entre 2 e 8 de janeiro, Batismo no domingo seguinte (ou na
 * segunda-feira, se a Epifania cair a 7 ou 8), Ascensão no 7.º domingo da Páscoa.
 * As chaves seguem a nomenclatura do LitCal (OrdWeekday28Wednesday, Lent2, …) para
 * poderem ser comparadas com ele nos testes.
 */

export type SundayCycle = 'A' | 'B' | 'C';
export type WeekdayCycle = 'I' | 'II';

export interface TemporalDay {
  key: string;
  /** Grau na escala do LitCal (0 féria … 7 superior a solenidade). */
  grade: number;
  /** Féria privilegiada: memórias não mudam as leituras (Quaresma, 17-24/12, oitavas). */
  privileged: boolean;
  /** As leituras dependem do ciclo dominical (domingos e solenidades/festas do Senhor móveis). */
  usesSundayCycle: boolean;
  /** As leituras dependem do ano par/ímpar (férias do Tempo Comum). */
  usesWeekdayCycle: boolean;
  sundayCycle: SundayCycle;
  weekdayCycle: WeekdayCycle;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const utc = (y: number, m: number, d: number) => DateTime.utc(y, m, d);
const diffDays = (a: DateTime, b: DateTime) => Math.round(a.diff(b, 'days').days);
/** Domingo no próprio dia ou anterior. */
const sundayOnOrBefore = (d: DateTime) => d.minus({ days: d.weekday % 7 });

export function firstSundayOfAdvent(year: number): DateTime {
  const christmas = utc(year, 12, 25);
  return sundayOnOrBefore(christmas.minus({ days: 1 })).minus({ weeks: 3 });
}

export function brEpiphany(year: number): DateTime {
  const jan2 = utc(year, 1, 2);
  return jan2.plus({ days: (7 - (jan2.weekday % 7)) % 7 });
}

export function brBaptism(year: number): DateTime {
  const epi = brEpiphany(year);
  return epi.day >= 7 ? epi.plus({ days: 1 }) : epi.plus({ days: 7 });
}

function holyFamily(year: number): DateTime {
  for (let d = 26; d <= 31; d++) if (utc(year, 12, d).weekday === 7) return utc(year, 12, d);
  return utc(year, 12, 30);
}

export function cyclesFor(date: DateTime): { sundayCycle: SundayCycle; weekdayCycle: WeekdayCycle } {
  // O ano litúrgico começa no 1.º domingo do Advento; o ciclo é o do ano civil em que termina.
  const endYear = date >= firstSundayOfAdvent(date.year) ? date.year + 1 : date.year;
  const sundayCycle = (['C', 'A', 'B'] as const)[endYear % 3]!;
  return { sundayCycle, weekdayCycle: endYear % 2 === 1 ? 'I' : 'II' };
}

export function temporalDay(isoDate: string): TemporalDay {
  const date = DateTime.fromISO(isoDate, { zone: 'utc' });
  if (!date.isValid) throw new RangeError(`Data inválida: ${isoDate}`);
  const y = date.year;
  const dow = DAY_NAMES[date.weekday - 1]!;
  const isSunday = date.weekday === 7;
  const cycles = cyclesFor(date);
  const day = (
    key: string,
    grade: number,
    extra: Partial<Pick<TemporalDay, 'privileged' | 'usesSundayCycle' | 'usesWeekdayCycle'>> = {},
  ): TemporalDay => ({
    key,
    grade,
    privileged: extra.privileged ?? grade >= 7,
    usesSundayCycle: extra.usesSundayCycle ?? false,
    usesWeekdayCycle: extra.usesWeekdayCycle ?? false,
    ...cycles,
  });
  const sunday = (key: string, grade: number) => day(key, grade, { usesSundayCycle: true });

  const easter = easterSunday(y);
  const ash = easter.minus({ days: 46 });
  const advent1 = firstSundayOfAdvent(y);
  const epiphany = brEpiphany(y);
  const baptism = brBaptism(y);
  const pentecost = easter.plus({ days: 49 });

  // Advento
  if (date >= advent1 && date < utc(y, 12, 25)) {
    const week = Math.floor(diffDays(date, advent1) / 7) + 1;
    if (isSunday) return sunday(`Advent${week}`, 7);
    if (date.month === 12 && date.day >= 17)
      return day(`AdventWeekdayDec${date.day}`, 0, { privileged: true });
    return day(`AdventWeekday${week}${dow}`, 0);
  }
  // Natal até 31/12
  if (date.month === 12 && date.day >= 25) {
    if (date.day === 25) return day('Christmas', 7);
    if (date.equals(holyFamily(y))) return sunday('HolyFamily', 5);
    return day(`ChristmasWeekdayDec${date.day}`, 0, { privileged: true });
  }
  // 1/1 até o Batismo
  if (date <= baptism) {
    if (date.month === 1 && date.day === 1) return day('MotherGod', 6);
    if (date.equals(epiphany)) return sunday('Epiphany', 7);
    if (date.equals(baptism)) return sunday('BaptismLord', 5);
    if (date < epiphany) return day(`ChristmasWeekdayJan${date.day}`, 0);
    return day(`AfterEpiphany${dow}`, 0);
  }
  // Tempo Comum antes da Quaresma
  if (date < ash) {
    const week = Math.floor(diffDays(date, sundayOnOrBefore(baptism)) / 7) + 1;
    if (isSunday) return sunday(`OrdSunday${week}`, 5);
    return day(`OrdWeekday${week}${dow}`, 0, { usesWeekdayCycle: true });
  }
  // Quaresma e Semana Santa
  if (date < easter) {
    const palm = easter.minus({ days: 7 });
    const offset = diffDays(date, ash);
    if (offset === 0) return day('AshWednesday', 7);
    if (offset <= 3) return day(`${dow}AfterAshWednesday`, 0, { privileged: true });
    if (date.equals(palm)) return sunday('PalmSun', 7);
    if (date > palm) {
      const holy: Record<number, string> = {
        1: 'MonHolyWeek',
        2: 'TueHolyWeek',
        3: 'WedHolyWeek',
        4: 'HolyThurs',
        5: 'GoodFri',
        6: 'EasterVigil',
      };
      return day(holy[date.weekday]!, 7);
    }
    const week = Math.floor((offset - 4) / 7) + 1;
    if (isSunday) return sunday(`Lent${week}`, 7);
    return day(`LentWeekday${week}${dow}`, 0, { privileged: true });
  }
  // Tempo Pascal
  if (date <= pentecost) {
    const offset = diffDays(date, easter);
    if (offset === 0) return day('Easter', 7);
    if (offset < 7) return day(`${dow.slice(0, 3)}OctaveEaster`, 7);
    if (date.equals(pentecost)) return sunday('Pentecost', 7);
    if (offset === 42) return sunday('Ascension', 7);
    const week = Math.floor(offset / 7) + 1;
    if (isSunday) return sunday(`Easter${week}`, 7);
    return day(`EasterWeekday${week}${dow}`, 0);
  }
  // Tempo Comum depois de Pentecostes
  const offset = diffDays(date, pentecost);
  if (offset === 7) return sunday('Trinity', 7);
  if (offset === 11) return sunday('CorpusChristi', 7);
  if (offset === 19) return sunday('SacredHeart', 6);
  const christKing = advent1.minus({ days: 7 });
  if (date.equals(christKing)) return sunday('ChristKing', 6);
  const week = 34 - Math.floor(diffDays(christKing, sundayOnOrBefore(date)) / 7);
  if (isSunday) return sunday(`OrdSunday${week}`, 5);
  return day(`OrdWeekday${week}${dow}`, 0, { usesWeekdayCycle: true });
}
