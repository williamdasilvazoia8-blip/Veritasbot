import { DateTime } from 'luxon';

/** Data civil local (ISO) no fuso informado. Nunca usa o fuso da máquina nem do provedor. */
export function localDate(timezone: string, offsetDays = 0, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).startOf('day').plus({ days: offsetDays }).toISODate()!;
}

/** "DD/MM/AAAA" → ISO, validando a data (ex.: 31/02 é rejeitado). */
export function parseBrDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const dt = DateTime.fromObject(
    { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) },
    { zone: 'utc' },
  );
  return dt.isValid ? dt.toISODate() : null;
}

/** ISO → "sexta-feira, 16 de outubro de 2026" */
export function formatLongDate(isoDate: string, locale = 'pt-BR'): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).setLocale(locale).toFormat("cccc, d 'de' LLLL 'de' yyyy");
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days }).toISODate()!;
}
