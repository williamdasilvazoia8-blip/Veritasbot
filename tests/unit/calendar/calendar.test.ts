import { describe, expect, it } from 'vitest';
import { easterSunday } from '../../../src/modules/calendar/rules/computus.js';
import { describeDay, movableDates } from '../../../src/modules/calendar/rules/general-roman-calendar.js';
import { calendarProviderFor } from '../../../src/modules/calendar/providers/calendar-provider.js';

describe('computus gregoriano', () => {
  it.each([
    [1818, '1818-03-22'],
    [1943, '1943-04-25'],
    [2000, '2000-04-23'],
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'],
  ])('Páscoa de %i = %s', (year, iso) => {
    expect(easterSunday(year).toISODate()).toBe(iso);
  });

  it('rejeita anos fora do calendário gregoriano', () => {
    expect(() => easterSunday(1500)).toThrow(RangeError);
  });
});

describe('Calendário Romano Geral — datas móveis 2026', () => {
  const m = movableDates(2026);
  it.each([
    ['ashWednesday', '2026-02-18'],
    ['palmSunday', '2026-03-29'],
    ['ascension', '2026-05-14'],
    ['pentecost', '2026-05-24'],
    ['corpusChristi', '2026-06-04'],
    ['christTheKing', '2026-11-22'],
    ['firstAdvent', '2026-11-29'],
    ['baptism', '2026-01-11'],
    ['holyFamily', '2026-12-27'],
  ] as const)('%s', (k, iso) => {
    expect(m[k].toISODate()).toBe(iso);
  });

  it('opções nacionais: Epifania e Ascensão no domingo', () => {
    const br = movableDates(2026, { epiphanyOnSunday: true, ascensionOnSunday: true });
    expect(br.epiphany.toISODate()).toBe('2026-01-04');
    expect(br.ascension.toISODate()).toBe('2026-05-17');
    // Epifania em 7 ou 8 de janeiro → Batismo na segunda-feira seguinte
    expect(movableDates(2029, { epiphanyOnSunday: true }).baptism.toISODate()).toBe('2029-01-08');
  });
});

describe('describeDay', () => {
  it.each([
    ['2026-10-16', 'ordinary', 28, 'A', 'II'],
    ['2026-11-22', 'ordinary', 34, 'A', 'II'],
    ['2026-11-29', 'advent', 1, 'B', 'I'],
    ['2026-02-22', 'lent', 1, 'A', 'II'],
    ['2026-04-03', 'triduum', null, 'A', 'II'],
    ['2026-04-12', 'easter', 2, 'A', 'II'],
    ['2026-05-25', 'ordinary', 8, 'A', 'II'],
    ['2027-01-11', 'ordinary', 1, 'B', 'I'],
    ['2026-12-31', 'christmas', null, 'B', 'I'],
  ])('%s → %s semana %s, ano %s/%s', (date, season, week, sunday, weekday) => {
    const d = describeDay(date);
    expect([d.season, d.week, d.sundayCycle, d.weekdayCycle]).toEqual([season, week, sunday, weekday]);
  });

  it('identifica solenidades e dias próprios', () => {
    expect(describeDay('2026-05-24').description).toBe('Domingo de Pentecostes');
    expect(describeDay('2026-12-08').observances.map((o) => o.name)).toContain(
      'Imaculada Conceição da Virgem Maria',
    );
    expect(describeDay('2026-02-18').observances[0]!.name).toBe('Quarta-feira de Cinzas');
  });

  it('declara explicitamente o que não calcula', () => {
    expect(describeDay('2026-03-19').unsupported).toContain('precedência e transferências');
  });
});

describe('provedores de calendário', () => {
  it('1962 é um provedor separado e ainda não suportado', () => {
    const r = calendarProviderFor('roman-1962').describe('2026-10-16');
    expect(r.supported).toBe(false);
  });
  it('forma ordinária é o padrão', () => {
    expect(calendarProviderFor('general-roman-of').describe('2026-10-16').supported).toBe(true);
  });
});
