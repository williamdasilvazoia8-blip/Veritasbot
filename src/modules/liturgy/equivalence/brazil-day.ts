import { DateTime } from 'luxon';
import type { LitcalEvent } from '../../calendar/providers/litcal/schema.js';
import { easterSunday } from '../../calendar/rules/computus.js';
import { temporalDay, type TemporalDay } from './temporal.js';

/**
 * Identidade litúrgica de um dia no calendário do BRASIL (o do serviço Liturgia Diária),
 * para qualquer ano a partir de 1970:
 * - ciclo temporal calculado (temporal.ts);
 * - santoral do Calendário Romano Geral vindo do LitCal (que já resolve precedências e
 *   transferências como São José/Anunciação na Semana Santa);
 * - ajustes do Brasil, conferidos com os dados do Liturgia Diária de 2024-2027:
 *   São Pedro e São Paulo, Assunção e Todos os Santos no domingo; Aparecida a 12/10.
 */

export interface BrazilDay {
  date: string;
  /**
   * O que define as leituras, da chave mais específica para a mais geral: dias com a
   * mesma chave têm as mesmas leituras (ex.: festa num domingo ganha 2.ª leitura).
   */
  readingsKeys: string[];
  /** A celebração do dia (título, orações, cor). */
  celebrationKey: string;
  temporal: TemporalDay;
  /** Celebração do santoral que prevalece, se houver. */
  sanctoral: { key: string; grade: number } | null;
}

/**
 * Memórias cujas leituras são PRÓPRIAS no Liturgia Diária (nas outras usam-se as leituras
 * da féria). Lista obtida comparando as leituras do serviço em 2024-2027.
 */
export const PROPER_READING_MEMORIALS = new Set<string>([
  'StsTimothyTitus',
  'MaryMotherChurch',
  'ImmaculateHeart',
  'StBarnabasAp',
  'StsJoachimAnne',
  'StMartha',
  'QueenshipMary',
  'BeheadingJohnBaptist',
  'GuardianAngels',
  'OurLadyOfTheRosary',
  'PresentationMary',
  'OurLadyOfSorrows',
]);

const GRADE_FEAST = 4;
const GRADE_FEAST_LORD = 5;
const GRADE_SOLEMNITY = 6;

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

/** Domingo dentro do intervalo [início, início+6]. */
function sundayFrom(year: number, month: number, day: number): string {
  const start = DateTime.utc(year, month, day);
  return start.plus({ days: (7 - (start.weekday % 7)) % 7 }).toISODate()!;
}

/** Datas do Brasil para solenidades transferidas para o domingo. */
export function brazilTransfers(year: number): Record<string, string> {
  const nov1 = DateTime.utc(year, 11, 1);
  return {
    StsPeterPaulAp: sundayFrom(year, 6, 28),
    Assumption: sundayFrom(year, 8, 15),
    // Se 1/11 for sábado, fica no sábado (o domingo é dos Fiéis Defuntos).
    AllSaints: nov1.weekday === 6 ? nov1.toISODate()! : sundayFrom(year, 11, 1),
  };
}

/** Parâmetros do LitCal equivalentes ao Brasil (Epifania e Ascensão no domingo). */
export const LITCAL_BRAZIL_SETTINGS = {
  epiphany: 'SUNDAY_JAN2_JAN8',
  ascension: 'SUNDAY',
  corpus_christi: 'THURSDAY',
} as const;

/** Graus diferentes no Brasil / América Latina (conferidos no Liturgia Diária). */
const BRAZIL_GRADES: Record<string, number> = {
  OurLadyOfMountCarmel: 4,
  OurLadyOfGuadalupe: 4,
  StRoseLima: 4,
  StMaryMagdalene: 4,
};

/** Memórias do calendário próprio do Brasil (ausentes do Calendário Romano Geral). */
const BRAZIL_MEMORIALS: Array<{ key: string; month: number; day: number }> = [
  { key: 'BR_StJoseAnchieta', month: 6, day: 9 },
  { key: 'BR_StPaulina', month: 7, day: 9 },
  { key: 'BR_BlIgnatiusAzevedo', month: 7, day: 17 },
  { key: 'BR_StDulce', month: 8, day: 13 },
  { key: 'BR_StsAndreSoveral', month: 10, day: 3 },
  { key: 'BR_StFreiGalvao', month: 10, day: 25 },
  { key: 'BR_StsRoqueGonzalez', month: 11, day: 19 },
];

/** Eventos do LitCal que o calendário temporal do Brasil substitui (datas diferentes no Brasil). */
const TEMPORAL_FROM_LITCAL = /^(Epiphany|BaptismLord|Ascension|Christmas2|MotherGod)$|_vigil$/;

/** Santoral do ano civil (LitCal) com os ajustes do Brasil, indexado por data. */
export function brazilSanctoral(year: number, events: LitcalEvent[]): Map<string, LitcalEvent[]> {
  const transfers = brazilTransfers(year);
  const byDate = new Map<string, LitcalEvent[]>();
  const add = (date: string, e: LitcalEvent) => byDate.set(date, [...(byDate.get(date) ?? []), e]);
  for (const e of events) {
    if (e.is_vigil_mass || e.year !== year) continue;
    if (e.type !== 'fixed' || TEMPORAL_FROM_LITCAL.test(e.event_key)) continue;
    let date = isoOf(e);
    if (e.event_key in transfers) date = transfers[e.event_key]!;
    // Imaculada Conceição num domingo do Advento: no Brasil celebra-se no domingo.
    if (
      e.event_key === 'ImmaculateConception' &&
      date === `${year}-12-09` &&
      utc(`${year}-12-08`).weekday === 7
    )
      date = `${year}-12-08`;
    add(date, e.event_key in BRAZIL_GRADES ? { ...e, grade: BRAZIL_GRADES[e.event_key]! } : e);
  }
  const synthetic = (key: string, date: string, grade: number): LitcalEvent => {
    const [, m, d] = date.split('-').map(Number) as [number, number, number];
    return { event_key: key, name: key, color: ['white'], grade, year, month: m, day: d, type: 'fixed' };
  };
  for (const m of BRAZIL_MEMORIALS) {
    const date = `${year}-${String(m.month).padStart(2, '0')}-${String(m.day).padStart(2, '0')}`;
    add(date, synthetic(m.key, date, 3));
  }
  // Memórias marianas móveis: Mãe da Igreja (2.ª-feira depois de Pentecostes) e Imaculado
  // Coração (sábado depois do Sagrado Coração) — obrigatórias no Brasil.
  const pentecost = easterSunday(year).plus({ days: 49 });
  add(
    pentecost.plus({ days: 1 }).toISODate()!,
    synthetic('MaryMotherChurch', pentecost.plus({ days: 1 }).toISODate()!, 3),
  );
  add(
    pentecost.plus({ days: 20 }).toISODate()!,
    synthetic('ImmaculateHeart', pentecost.plus({ days: 20 }).toISODate()!, 3),
  );
  const aparecida: LitcalEvent = {
    event_key: 'Aparecida',
    name: 'Nossa Senhora da Conceição Aparecida',
    color: ['white'],
    grade: GRADE_SOLEMNITY,
    year,
    month: 10,
    day: 12,
    type: 'fixed',
  };
  add(`${year}-10-12`, aparecida);
  return byDate;
}

function isoOf(e: LitcalEvent): string {
  return `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
}

/**
 * Precedência simplificada (só o que muda as LEITURAS):
 * - solenidades (6) vencem domingos do Tempo Comum/Natal e férias; domingos do Advento,
 *   Quaresma e Páscoa e dias de grau 7 vencem tudo (o LitCal já transfere o que colide);
 * - festas (4/5) vencem férias; festas do Senhor (5) também vencem domingos do Tempo Comum;
 * - memórias nunca mudam as leituras, salvo as de leituras próprias, e não valem em férias
 *   privilegiadas nem aos domingos.
 */
export function brazilDay(isoDate: string, sanctoral: Map<string, LitcalEvent[]>): BrazilDay {
  const temporal = temporalDay(isoDate);
  const isSunday = utc(isoDate).weekday === 7;
  // Em empate de grau, o Calendário Romano Geral vence o próprio do Brasil (ex.: 9/6/2025,
  // Mãe da Igreja e não São José de Anchieta).
  const national = (e: LitcalEvent) => (e.event_key.startsWith('BR_') ? 1 : 0);
  const candidates = (sanctoral.get(isoDate) ?? [])
    .filter((e) => e.grade >= 2)
    .sort((a, b) => b.grade - a.grade || national(a) - national(b));

  let winner: LitcalEvent | null = null;
  for (const e of candidates) {
    const g = e.grade;
    let wins: boolean;
    if (temporal.grade >= 7)
      wins = e.event_key === 'ImmaculateConception' && temporal.key.startsWith('Advent');
    else if (g >= GRADE_SOLEMNITY) wins = true;
    else if (g === GRADE_FEAST_LORD) wins = !isSunday || temporal.grade <= GRADE_FEAST_LORD;
    else if (g === GRADE_FEAST) wins = !isSunday;
    else wins = !isSunday && !temporal.privileged;
    if (wins) {
      winner = e;
      break;
    }
  }

  const temporalReadings = [
    temporal.key,
    temporal.usesSundayCycle ? temporal.sundayCycle : '',
    temporal.usesWeekdayCycle ? temporal.weekdayCycle : '',
  ]
    .filter(Boolean)
    .join(':');
  // Algumas férias mudam com o ciclo dominical (ex.: 2.ª-feira da 1.ª semana do Advento,
  // 2.ª-feira da 4.ª semana da Páscoa): prefere-se um dia do mesmo ciclo quando existe.
  const temporalKeys = temporal.usesSundayCycle
    ? [temporalReadings]
    : [`${temporalReadings}:${temporal.sundayCycle}`, temporalReadings];

  if (!winner)
    return {
      date: isoDate,
      readingsKeys: temporalKeys,
      celebrationKey: temporalReadings,
      temporal,
      sanctoral: null,
    };

  const sanctoralKey = `saint:${winner.event_key}`;
  const ownReadings = winner.grade >= GRADE_FEAST || PROPER_READING_MEMORIALS.has(winner.event_key);
  // Festa ao domingo tem 2.ª leitura; festas do Senhor podem variar com o ciclo (Transfiguração).
  const sundayPart = isSunday ? ':dom' : '';
  const cyclePart = winner.grade === GRADE_FEAST_LORD ? `:${temporal.sundayCycle}` : '';
  const keys = ownReadings
    ? [
        ...new Set([
          `${sanctoralKey}${sundayPart}${cyclePart}`,
          `${sanctoralKey}${cyclePart}`,
          `${sanctoralKey}${sundayPart}`,
          sanctoralKey,
        ]),
      ]
    : temporalKeys;
  // Memória facultativa: o dia continua a ser a féria (é assim que o serviço o apresenta).
  return {
    date: isoDate,
    readingsKeys: keys,
    celebrationKey: winner.grade >= 3 ? sanctoralKey : temporalReadings,
    temporal,
    sanctoral: { key: winner.event_key, grade: winner.grade },
  };
}
