import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrence, parseLocal } from '../../../src/modules/scheduling/domain/recurrence.js';

describe('occurrence — fusos e horário de verão', () => {
  it('converte hora local no fuso do agendamento', () => {
    expect(occurrence('2026-12-08T08:00', 'America/Sao_Paulo', 'ONCE', 0).runAt.toISOString()).toBe(
      '2026-12-08T11:00:00.000Z',
    );
    expect(occurrence('2026-12-08T12:00', 'Europe/Lisbon', 'ONCE', 0).runAt.toISOString()).toBe(
      '2026-12-08T12:00:00.000Z',
    );
  });

  it('hora inexistente (adiantamento) avança pelo salto', () => {
    // Lisboa 2027-03-28: 01:00 → 02:00
    expect(occurrence('2027-03-28T01:30', 'Europe/Lisbon', 'ONCE', 0).runAt.toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
    expect(occurrence('2027-03-14T02:30', 'America/New_York', 'ONCE', 0).runAt.toISOString()).toBe(
      '2027-03-14T07:30:00.000Z',
    );
  });

  it('hora repetida (atraso) usa a primeira ocorrência', () => {
    expect(occurrence('2026-10-25T01:30', 'Europe/Lisbon', 'ONCE', 0).runAt.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(occurrence('2026-11-01T01:30', 'America/New_York', 'ONCE', 0).runAt.toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('diário mantém a hora local através da mudança de horário', () => {
    const before = occurrence('2026-10-24T12:00', 'Europe/Lisbon', 'DAILY', 0);
    const after = occurrence('2026-10-24T12:00', 'Europe/Lisbon', 'DAILY', 1);
    expect(before.runAt.toISOString()).toBe('2026-10-24T11:00:00.000Z');
    expect(after.runAt.toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(after.key).toBe('2026-10-25T12:00');
  });

  it('mensal ancorado no dia 31 não deriva', () => {
    expect([0, 1, 2, 3].map((n) => occurrence('2027-01-31T08:00', 'UTC', 'MONTHLY', n).key)).toEqual([
      '2027-01-31T08:00',
      '2027-02-28T08:00',
      '2027-03-31T08:00',
      '2027-04-30T08:00',
    ]);
  });

  it('anual em 29/02 volta a 29/02 nos anos bissextos', () => {
    expect([0, 1, 4].map((n) => occurrence('2028-02-29T08:00', 'UTC', 'YEARLY', n).key)).toEqual([
      '2028-02-29T08:00',
      '2029-02-28T08:00',
      '2032-02-29T08:00',
    ]);
  });

  it('semanal repete no mesmo dia da semana', () => {
    expect(occurrence('2026-10-18T09:00', 'UTC', 'WEEKLY', 3).key).toBe('2026-11-08T09:00');
  });
});

describe('nextOccurrence', () => {
  it('ocorrência única no passado não tem próxima', () => {
    expect(nextOccurrence('2020-01-01T00:00', 'UTC', 'ONCE', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('é estritamente posterior ao instante dado', () => {
    const n = nextOccurrence('2026-01-01T12:00', 'UTC', 'DAILY', new Date('2026-10-16T12:00:00Z'));
    expect(n?.key).toBe('2026-10-17T12:00');
  });

  it('encontra a próxima em séries longas', () => {
    const n = nextOccurrence('2000-01-31T08:00', 'UTC', 'MONTHLY', new Date('2026-10-16T00:00:00Z'));
    expect(n?.key).toBe('2026-10-31T08:00');
  });

  it('valida a data/hora local', () => {
    expect(() => parseLocal('2026-02-30T08:00')).toThrow();
    expect(() => parseLocal('2026-02-10T24:00')).toThrow();
  });
});
