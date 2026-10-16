import { DateTime } from 'luxon';
import { easterSunday } from './computus.js';

/**
 * Fundamento do Calendário Romano Geral (forma ordinária, Missal de Paulo VI).
 *
 * ESCOPO VERIFICADO: datas móveis derivadas da Páscoa, limites dos tempos
 * litúrgicos, numeração de semanas, ciclos dominical (A/B/C) e ferial (I/II) e
 * um pequeno conjunto de solenidades/festas universais com data fixa.
 *
 * NÃO IMPLEMENTADO (o bot informa explicitamente): tabela de precedência,
 * transferências (ex.: São José/Anunciação na Semana Santa), memórias,
 * calendários nacionais/diocesanos. Para isso o bot usa a celebração do provedor.
 */

export type Season = 'advent' | 'christmas' | 'lent' | 'triduum' | 'easter' | 'ordinary';

export const SEASON_LABEL: Record<Season, string> = {
  advent: 'Advento',
  christmas: 'Tempo do Natal',
  lent: 'Quaresma',
  triduum: 'Tríduo Pascal',
  easter: 'Tempo Pascal',
  ordinary: 'Tempo Comum',
};

export interface CalendarOptions {
  /** Epifania no domingo entre 2 e 8 de janeiro (ex.: Brasil). Padrão: 6 de janeiro. */
  epiphanyOnSunday?: boolean;
  /** Ascensão no 7º domingo da Páscoa (ex.: Brasil). Padrão: quinta-feira (Páscoa + 39). */
  ascensionOnSunday?: boolean;
}

export interface Observance {
  name: string;
  rank: 'solenidade' | 'festa' | 'comemoração' | 'dia litúrgico próprio';
  movable: boolean;
}

export interface DayInfo {
  date: string;
  season: Season;
  seasonLabel: string;
  /** Semana dentro do tempo (null quando não se aplica, ex.: dias após as Cinzas, oitava do Natal). */
  week: number | null;
  description: string;
  sundayCycle: 'A' | 'B' | 'C';
  weekdayCycle: 'I' | 'II';
  /** Observâncias conhecidas pela regra (sem resolver precedência). */
  observances: Observance[];
  unsupported: string[];
}

const iso = (d: DateTime) => d.toISODate()!;

function firstSundayOfAdvent(year: number): DateTime {
  const christmas = DateTime.utc(year, 12, 25);
  // Domingo anterior ao Natal (se o Natal for domingo, o domingo anterior) menos 3 semanas.
  const sundayBefore = christmas.minus({ days: christmas.weekday % 7 === 0 ? 7 : christmas.weekday % 7 });
  return sundayBefore.minus({ weeks: 3 });
}

function epiphany(year: number, opts: CalendarOptions): DateTime {
  if (!opts.epiphanyOnSunday) return DateTime.utc(year, 1, 6);
  const jan2 = DateTime.utc(year, 1, 2);
  return jan2.plus({ days: (7 - (jan2.weekday % 7)) % 7 });
}

function baptismOfTheLord(year: number, opts: CalendarOptions): DateTime {
  const epi = epiphany(year, opts);
  if (opts.epiphanyOnSunday) {
    // Se a Epifania cai em 7 ou 8 de janeiro, o Batismo é na segunda-feira seguinte.
    return epi.day >= 7 ? epi.plus({ days: 1 }) : epi.plus({ days: 7 });
  }
  // Domingo depois de 6 de janeiro.
  return epi.plus({ days: 7 - (epi.weekday % 7 === 0 ? 0 : epi.weekday % 7) || 7 });
}

function holyFamily(year: number): DateTime {
  // Domingo na oitava do Natal; se não houver, 30 de dezembro.
  for (let d = 26; d <= 31; d++) {
    const dt = DateTime.utc(year, 12, d);
    if (dt.weekday === 7) return dt;
  }
  return DateTime.utc(year, 12, 30);
}

export function movableDates(year: number, opts: CalendarOptions = {}) {
  const easter = easterSunday(year);
  return {
    baptism: baptismOfTheLord(year, opts),
    ashWednesday: easter.minus({ days: 46 }),
    palmSunday: easter.minus({ days: 7 }),
    holyThursday: easter.minus({ days: 3 }),
    goodFriday: easter.minus({ days: 2 }),
    holySaturday: easter.minus({ days: 1 }),
    easter,
    divineMercy: easter.plus({ days: 7 }),
    ascension: easter.plus({ days: opts.ascensionOnSunday ? 42 : 39 }),
    pentecost: easter.plus({ days: 49 }),
    trinity: easter.plus({ days: 56 }),
    corpusChristi: easter.plus({ days: 60 }),
    sacredHeart: easter.plus({ days: 68 }),
    christTheKing: firstSundayOfAdvent(year).minus({ days: 7 }),
    firstAdvent: firstSundayOfAdvent(year),
    holyFamily: holyFamily(year),
    epiphany: epiphany(year, opts),
  };
}

const FIXED: Record<string, Observance> = {
  '01-01': { name: 'Santa Maria, Mãe de Deus', rank: 'solenidade', movable: false },
  '02-02': { name: 'Apresentação do Senhor', rank: 'festa', movable: false },
  '03-19': { name: 'São José, Esposo da Virgem Maria', rank: 'solenidade', movable: false },
  '03-25': { name: 'Anunciação do Senhor', rank: 'solenidade', movable: false },
  '06-24': { name: 'Natividade de São João Batista', rank: 'solenidade', movable: false },
  '06-29': { name: 'São Pedro e São Paulo, Apóstolos', rank: 'solenidade', movable: false },
  '08-06': { name: 'Transfiguração do Senhor', rank: 'festa', movable: false },
  '08-15': { name: 'Assunção de Nossa Senhora', rank: 'solenidade', movable: false },
  '09-14': { name: 'Exaltação da Santa Cruz', rank: 'festa', movable: false },
  '11-01': { name: 'Todos os Santos', rank: 'solenidade', movable: false },
  '11-02': { name: 'Comemoração de Todos os Fiéis Defuntos', rank: 'comemoração', movable: false },
  '12-08': { name: 'Imaculada Conceição da Virgem Maria', rank: 'solenidade', movable: false },
  '12-25': { name: 'Natal do Senhor', rank: 'solenidade', movable: false },
};

export function describeDay(isoDate: string, opts: CalendarOptions = {}): DayInfo {
  const date = DateTime.fromISO(isoDate, { zone: 'utc' });
  if (!date.isValid) throw new RangeError(`Data inválida: ${isoDate}`);
  const y = date.year;
  const cur = movableDates(y, opts);
  const days = (a: DateTime, b: DateTime) => Math.round(a.diff(b, 'days').days);

  // Ano litúrgico começa no 1º domingo do Advento.
  const litYearStart = date >= cur.firstAdvent ? y : y - 1;
  const sundayCycle = (['C', 'A', 'B'] as const)[(litYearStart + 1) % 3]!;
  const weekdayCycle = (litYearStart + 1) % 2 === 1 ? 'I' : 'II';

  let season: Season;
  let week: number | null = null;
  let description: string;
  const weekdayName = [
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
    'domingo',
  ][date.weekday - 1]!;
  const dayLabel = (w: number, s: string) =>
    date.weekday === 7 ? `${w}º Domingo ${s}` : `${weekdayName} da ${w}ª semana ${s}`;

  if (date >= cur.firstAdvent && date < DateTime.utc(y, 12, 25)) {
    season = 'advent';
    week = Math.floor(days(date, cur.firstAdvent) / 7) + 1;
    description = dayLabel(week, 'do Advento');
  } else if (date >= DateTime.utc(y, 12, 25) || date <= cur.baptism) {
    season = 'christmas';
    description = 'Tempo do Natal';
  } else if (date < cur.ashWednesday) {
    season = 'ordinary';
    week = Math.floor(days(date, cur.baptism) / 7) + 1;
    description = dayLabel(week, 'do Tempo Comum');
  } else if (date < cur.holyThursday) {
    season = 'lent';
    const firstSundayLent = cur.ashWednesday.plus({ days: 4 });
    if (date < firstSundayLent) {
      description = `${weekdayName} depois das Cinzas`;
    } else if (date >= cur.palmSunday) {
      description = date.equals(cur.palmSunday)
        ? 'Domingo de Ramos e da Paixão do Senhor'
        : `${weekdayName} da Semana Santa`;
    } else {
      week = Math.floor(days(date, firstSundayLent) / 7) + 1;
      description = dayLabel(week, 'da Quaresma');
    }
  } else if (date <= cur.easter) {
    season = 'triduum';
    description = date.equals(cur.easter)
      ? 'Domingo da Páscoa da Ressurreição do Senhor'
      : `${weekdayName} santa`;
  } else if (date <= cur.pentecost) {
    season = 'easter';
    week = Math.floor(days(date, cur.easter) / 7) + 1;
    if (date.equals(cur.pentecost)) description = 'Domingo de Pentecostes';
    else if (week === 1) description = `${weekdayName} na Oitava da Páscoa`;
    else description = dayLabel(week, 'da Páscoa');
  } else {
    season = 'ordinary';
    const weeksBeforeAdvent = Math.ceil(days(cur.firstAdvent, date) / 7);
    week = 35 - weeksBeforeAdvent;
    description = dayLabel(week, 'do Tempo Comum');
  }

  const observances: Observance[] = [];
  const movable: Array<[DateTime, Observance]> = [
    [cur.ashWednesday, { name: 'Quarta-feira de Cinzas', rank: 'dia litúrgico próprio', movable: true }],
    [
      cur.palmSunday,
      { name: 'Domingo de Ramos e da Paixão do Senhor', rank: 'dia litúrgico próprio', movable: true },
    ],
    [
      cur.holyThursday,
      {
        name: 'Quinta-feira Santa (à tarde: Missa da Ceia do Senhor)',
        rank: 'dia litúrgico próprio',
        movable: true,
      },
    ],
    [
      cur.goodFriday,
      { name: 'Sexta-feira da Paixão do Senhor', rank: 'dia litúrgico próprio', movable: true },
    ],
    [
      cur.holySaturday,
      { name: 'Sábado Santo (à noite: Vigília Pascal)', rank: 'dia litúrgico próprio', movable: true },
    ],
    [cur.easter, { name: 'Páscoa da Ressurreição do Senhor', rank: 'solenidade', movable: true }],
    [
      cur.divineMercy,
      { name: '2º Domingo da Páscoa (da Divina Misericórdia)', rank: 'dia litúrgico próprio', movable: true },
    ],
    [cur.ascension, { name: 'Ascensão do Senhor', rank: 'solenidade', movable: true }],
    [cur.pentecost, { name: 'Domingo de Pentecostes', rank: 'solenidade', movable: true }],
    [cur.trinity, { name: 'Santíssima Trindade', rank: 'solenidade', movable: true }],
    [cur.corpusChristi, { name: 'Santíssimo Corpo e Sangue de Cristo', rank: 'solenidade', movable: true }],
    [cur.sacredHeart, { name: 'Sagrado Coração de Jesus', rank: 'solenidade', movable: true }],
    [
      cur.christTheKing,
      { name: 'Nosso Senhor Jesus Cristo, Rei do Universo', rank: 'solenidade', movable: true },
    ],
    [cur.baptism, { name: 'Batismo do Senhor', rank: 'festa', movable: true }],
    [cur.holyFamily, { name: 'Sagrada Família de Jesus, Maria e José', rank: 'festa', movable: true }],
    [
      cur.epiphany,
      { name: 'Epifania do Senhor', rank: 'solenidade', movable: Boolean(opts.epiphanyOnSunday) },
    ],
  ];
  for (const [d, o] of movable) if (d.equals(date)) observances.push(o);
  const fixed = FIXED[date.toFormat('MM-dd')];
  if (fixed) observances.push(fixed);

  return {
    date: iso(date),
    season,
    seasonLabel: SEASON_LABEL[season],
    week,
    description,
    sundayCycle,
    weekdayCycle,
    observances,
    unsupported: [
      'precedência e transferências',
      'memórias e festas de santos (exceto as listadas)',
      'calendários nacionais e diocesanos',
    ],
  };
}
