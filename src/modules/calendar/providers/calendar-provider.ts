import { describeDay, type DayInfo } from '../rules/general-roman-calendar.js';

export type CalendarVariant = 'general-roman-of' | 'roman-1962';

export type CalendarResult = { supported: true; day: DayInfo } | { supported: false; reason: string };

export interface CalendarProvider {
  readonly variant: CalendarVariant;
  readonly label: string;
  describe(isoDate: string): CalendarResult;
}

/** Calendário Romano Geral (forma ordinária) — fundamento verificado, sem precedência. */
export class GeneralRomanCalendarProvider implements CalendarProvider {
  readonly variant = 'general-roman-of' as const;
  readonly label = 'Calendário Romano Geral (forma ordinária)';
  describe(isoDate: string): CalendarResult {
    return { supported: true, day: describeDay(isoDate) };
  }
}

/**
 * Calendário dos livros litúrgicos de 1962. Provedor SEPARADO por desenho: não
 * compartilha regras nem dados com a forma ordinária nem com a API Liturgia Diária.
 * Ainda não implementado — ver docs/calendar-roadmap.md.
 */
export class Roman1962CalendarProvider implements CalendarProvider {
  readonly variant = 'roman-1962' as const;
  readonly label = 'Calendário de 1962 (forma extraordinária)';
  describe(): CalendarResult {
    return {
      supported: false,
      reason: 'O calendário de 1962 ainda não está implementado neste bot (planejado; ver roteiro).',
    };
  }
}

export function calendarProviderFor(variant: string): CalendarProvider {
  return variant === 'roman-1962' ? new Roman1962CalendarProvider() : new GeneralRomanCalendarProvider();
}
