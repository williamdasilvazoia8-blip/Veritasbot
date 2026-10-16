import { describe, expect, it } from 'vitest';
import { temporalDay } from '../../../src/modules/liturgy/equivalence/temporal.js';
import {
  brazilDay,
  brazilSanctoral,
  brazilTransfers,
} from '../../../src/modules/liturgy/equivalence/brazil-day.js';
import { LiturgyEquivalenceService } from '../../../src/modules/liturgy/equivalence/equivalence-service.js';
import {
  describeLiturgyFailure,
  LiturgyService,
} from '../../../src/modules/liturgy/application/liturgy-service.js';
import { equivalenceNote, liturgyFooter } from '../../../src/modules/liturgy/presentation/embeds.js';
import type { LitcalEvent } from '../../../src/modules/calendar/providers/litcal/schema.js';
import type { LiturgicalDay, LiturgyProvider } from '../../../src/modules/liturgy/domain/types.js';

const ev = (event_key: string, date: string, grade: number, type = 'fixed'): LitcalEvent => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { event_key, name: event_key, color: ['white'], grade, year, month, day, type };
};

describe('ciclo temporal (Brasil), qualquer ano', () => {
  it.each([
    ['2002-03-31', 'Easter'],
    ['2002-05-19', 'Pentecost'],
    ['2030-04-21', 'Easter'],
    ['2030-06-02', 'Ascension'], // 7.º domingo da Páscoa no Brasil
    ['2030-05-30', 'EasterWeekday6Thursday'],
    ['2030-06-20', 'CorpusChristi'], // quinta-feira
    ['2030-06-28', 'SacredHeart'],
    ['2030-11-24', 'ChristKing'],
    ['2024-01-07', 'Epiphany'], // domingo entre 2 e 8/1
    ['2024-01-08', 'BaptismLord'], // segunda-feira (Epifania a 7)
    ['2024-01-14', 'OrdSunday2'],
    ['2025-01-06', 'AfterEpiphanyMonday'],
    ['2025-03-06', 'ThursdayAfterAshWednesday'],
    ['2025-03-09', 'Lent1'],
    ['2025-04-13', 'PalmSun'],
    ['2025-04-19', 'EasterVigil'],
    ['2025-04-22', 'TueOctaveEaster'],
    ['2023-12-24', 'Advent4'],
    ['2024-12-17', 'AdventWeekdayDec17'],
    ['2027-11-29', 'AdventWeekday1Monday'],
    ['2022-12-30', 'HolyFamily'], // Natal num domingo: sem domingo na oitava
    ['2026-10-16', 'OrdWeekday28Friday'],
  ])('%s → %s', (date, key) => {
    expect(temporalDay(date).key).toBe(key);
  });

  it('ciclos A/B/C e I/II mudam no 1.º domingo do Advento', () => {
    expect(temporalDay('2025-11-29')).toMatchObject({ sundayCycle: 'C', weekdayCycle: 'I' });
    expect(temporalDay('2025-11-30')).toMatchObject({ sundayCycle: 'A', weekdayCycle: 'II' });
    expect(temporalDay('2002-03-31').sundayCycle).toBe('A');
    expect(temporalDay('2030-07-14')).toMatchObject({ key: 'OrdSunday15', sundayCycle: 'B' });
  });
});

describe('calendário do Brasil', () => {
  it('transfere Pedro e Paulo, Assunção e Todos os Santos para o domingo', () => {
    expect(brazilTransfers(2026)).toEqual({
      StsPeterPaulAp: '2026-06-28',
      Assumption: '2026-08-16',
      AllSaints: '2026-11-01',
    });
    expect(brazilTransfers(2027).AllSaints).toBe('2027-11-07');
    expect(brazilTransfers(2025).AllSaints).toBe('2025-11-01'); // sábado: fica no dia
  });

  const sanct = brazilSanctoral(2026, [
    ev('StsPeterPaulAp', '2026-06-29', 6),
    ev('StMartha', '2026-07-29', 3),
    ev('StTeresaJesus', '2026-10-15', 3),
    ev('StHedwig', '2026-10-16', 2),
    ev('StMatthiasAp', '2026-05-14', 4),
    ev('StEphrem', '2026-06-09', 2),
  ]);

  it('solenidade transferida vence o domingo; o dia original volta a ser féria', () => {
    expect(brazilDay('2026-06-28', sanct).readingsKeys).toEqual([
      'saint:StsPeterPaulAp:dom',
      'saint:StsPeterPaulAp',
    ]);
    expect(brazilDay('2026-06-29', sanct).sanctoral).toBeNull();
  });

  it('Aparecida (12/10) existe todos os anos', () => {
    expect(brazilDay('2026-10-12', sanct).celebrationKey).toBe('saint:Aparecida');
  });

  it('memória usa as leituras da féria, salvo as de leituras próprias', () => {
    const teresa = brazilDay('2026-10-15', sanct);
    expect(teresa.celebrationKey).toBe('saint:StTeresaJesus');
    expect(teresa.readingsKeys).toEqual(['OrdWeekday28Thursday:II:A', 'OrdWeekday28Thursday:II']);
    expect(brazilDay('2026-07-29', sanct).readingsKeys).toEqual(['saint:StMartha']);
  });

  it('memória facultativa não muda a celebração', () => {
    expect(brazilDay('2026-10-16', sanct)).toMatchObject({
      celebrationKey: 'OrdWeekday28Friday:II',
      sanctoral: { key: 'StHedwig' },
    });
  });

  it('memória do Brasil cede à do calendário geral no mesmo grau (Mãe da Igreja)', () => {
    const s2025 = brazilSanctoral(2025, []);
    expect(brazilDay('2025-06-09', s2025).celebrationKey).toBe('saint:MaryMotherChurch');
    expect(brazilDay('2027-06-09', brazilSanctoral(2027, [])).celebrationKey).toBe('saint:BR_StJoseAnchieta');
  });
});

/** LitCal falso: só o que cada teste precisa (sem rede). */
const fakeLitcal = (events: Record<number, LitcalEvent[]> = {}) => ({
  calls: [] as number[],
  async getYear(year: number) {
    this.calls.push(year);
    return events[year] ?? [];
  },
});

const day = (date: string, name: string, refs: string[] = ['Ref 1']): LiturgicalDay => ({
  date,
  source: 'dancrf-liturgia-diaria',
  sourceVersion: 'v2',
  celebrations: [
    {
      id: date,
      name,
      isPrimary: true,
      color: 'Branco',
      prayers: { collect: `Coleta de ${name}`, extras: [] },
      antiphons: {},
      readings: [
        {
          order: 1,
          type: 'evangelho',
          label: 'Evangelho',
          options: refs.map((reference) => ({ reference, text: 't' })),
        },
      ],
    },
  ],
});

/** Serviço que só tem 2024-2027, como o Liturgia Diária. */
function windowProvider(days: Record<string, LiturgicalDay>): LiturgyProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    version: 'v2',
    calls,
    async getDay(date) {
      calls.push(date);
      return days[date] ?? null;
    },
  };
}

describe('LiturgyEquivalenceService', () => {
  it('Ascensão de 2030 (ano B) → Ascensão de 2024 (ano B), mesma celebração', async () => {
    const eq = new LiturgyEquivalenceService(fakeLitcal());
    const plan = await eq.plan('2030-06-02');
    expect(plan?.readings[0]).toEqual({ date: '2024-05-12', sameCelebration: true, exact: true });
  });

  it('sem data antes de 1970 nem para combinações ausentes da janela', async () => {
    const eq = new LiturgyEquivalenceService(fakeLitcal());
    expect(eq.supports('1969-12-25')).toBe(false);
    expect(await eq.plan('1969-12-25')).toBeNull();
    expect(await eq.plan('2011-02-20')).toBeNull(); // 7.º domingo do Tempo Comum, ano A
  });

  it('carrega cada ano do LitCal uma só vez', async () => {
    const litcal = fakeLitcal();
    const eq = new LiturgyEquivalenceService(litcal);
    await eq.plan('2030-06-02');
    await eq.plan('2030-06-09');
    expect(litcal.calls.sort()).toEqual([2024, 2025, 2026, 2027, 2030]);
  });
});

describe('LiturgyService com datas equivalentes', () => {
  const service = (days: Record<string, LiturgicalDay>, events: Record<number, LitcalEvent[]> = {}) => {
    const provider = windowProvider(days);
    return {
      provider,
      s: new LiturgyService({
        providers: { v2: provider },
        defaultVersion: 'v2',
        v3Enabled: false,
        equivalence: new LiturgyEquivalenceService(fakeLitcal(events)),
      }),
    };
  };

  it('usa o dia do serviço com a mesma celebração e indica a origem', async () => {
    const { s } = service({ '2024-03-31': day('2024-03-31', 'Domingo da Páscoa', ['Jo 20,1-9']) });
    const r = await s.getDay('2030-04-21', 'v2');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.day.date).toBe('2030-04-21');
    expect(r.day.celebrations[0]!.name).toBe('Domingo da Páscoa');
    expect(r.day.equivalent).toEqual({
      readingsDate: '2024-03-31',
      celebrationDate: '2024-03-31',
      exact: true,
    });
    expect(equivalenceNote(r.day)).toContain('31/03/2024');
    expect(liturgyFooter(r.day)).toContain('data equivalente');
  });

  it('memória sem a mesma celebração na janela: leituras da féria, título calculado, sem orações', async () => {
    // 15/10/2030 (3.ª-feira, 28.ª semana, ano II) com uma memória que não existe em 2024-2027.
    const target = '2030-10-15';
    const { s } = service(
      { '2026-10-13': day('2026-10-13', '3ª feira da 28ª Semana do Tempo Comum', ['Lc 11,37-41']) },
      { 2030: [{ ...ev('StInvented', target, 3), name: 'Saint Invented' }] },
    );
    const r = await s.getDay(target, 'v2');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const c = r.day.celebrations[0]!;
    expect(c.readings[0]!.options[0]!.reference).toBe('Lc 11,37-41');
    expect(c.name).toContain('Saint Invented (nome do Calendário Romano)');
    expect(c.prayers.collect).toBeUndefined();
    expect(r.day.equivalent?.celebrationDate).toBeNull();
    expect(equivalenceNote(r.day)).toContain('orações próprias indisponíveis');
  });

  it('explica quando não há data equivalente ou a data é anterior a 1970', async () => {
    const { s } = service({});
    const before = await s.getDay('1965-12-25', 'v2');
    expect(before).toMatchObject({ status: 'not-found', reason: 'before-1970' });
    const none = await s.getDay('2011-02-20', 'v2');
    expect(none).toMatchObject({ status: 'not-found', reason: 'no-equivalent' });
    if (none.status === 'not-found')
      expect(describeLiturgyFailure(none)).toMatch(/mesma celebração e o mesmo ciclo/);
  });

  it('datas que o serviço tem continuam a vir diretamente', async () => {
    const { s, provider } = service({ '2026-10-16': day('2026-10-16', 'Féria') });
    const r = await s.getDay('2026-10-16', 'v2');
    expect(r.status === 'ok' && r.day.equivalent).toBeFalsy();
    expect(provider.calls).toEqual(['2026-10-16']);
  });
});

describe('antes de 1970', () => {
  it('liturgia, calendário e santos explicam a mudança de 1970 e o calendário tradicional', async () => {
    const { PRE_1970_MESSAGE } = await import('../../../src/modules/calendar/rules/pre-1970.js');
    const { GeneralRomanCalendarProvider } =
      await import('../../../src/modules/calendar/providers/calendar-provider.js');
    const { SaintsService } = await import('../../../src/modules/calendar/application/saints-service.js');
    expect(PRE_1970_MESSAGE).toMatch(/mudou em 1970/);
    expect(PRE_1970_MESSAGE).toMatch(/calendário tradicional/);

    const provider = windowProvider({});
    const s = new LiturgyService({ providers: { v2: provider }, defaultVersion: 'v2', v3Enabled: false });
    const r = await s.getDay('1962-12-25', 'v2');
    expect(r).toMatchObject({ status: 'not-found', reason: 'before-1970' });
    if (r.status === 'not-found') expect(describeLiturgyFailure(r)).toBe(PRE_1970_MESSAGE);
    expect(provider.calls).toEqual([]);

    expect(new GeneralRomanCalendarProvider().describe('1965-04-18')).toEqual({
      supported: false,
      reason: PRE_1970_MESSAGE,
    });
    const saints = new SaintsService(fakeLitcal() as never);
    expect(await saints.getDay('1962-01-01', 'GENERAL', 'la')).toMatchObject({ reason: 'before-1970' });
  });
});
