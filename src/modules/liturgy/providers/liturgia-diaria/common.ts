import { z } from 'zod';

/** Texto opcional e tolerante: aceita string, null ou ausência; strings vazias viram undefined. */
export const optText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/** Lista tolerante: aceita array, ausência/null ou string avulsa (versões antigas usavam texto como "Não há…"). */
export function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(item));
}

export const prayerExtraSchema = z.object({ titulo: optText, texto: optText });

export const prayersSchema = z
  .object({
    coleta: optText,
    oferendas: optText,
    comunhao: optText,
    extras: lenientArray(prayerExtraSchema),
  })
  .partial()
  .nullish();

export const antiphonsSchema = z.object({ entrada: optText, comunhao: optText }).partial().nullish();

export const notFoundSchema = z.object({ erro: z.string(), data: z.string().optional() });

export function normalizePrayers(p: z.infer<typeof prayersSchema>) {
  return {
    ...(p?.coleta ? { collect: p.coleta } : {}),
    ...(p?.oferendas ? { offerings: p.oferendas } : {}),
    ...(p?.comunhao ? { communion: p.comunhao } : {}),
    extras: (p?.extras ?? [])
      .filter((e): e is { titulo: string | undefined; texto: string } => Boolean(e.texto))
      .map((e) => ({ title: e.titulo ?? 'Oração', text: e.texto })),
  };
}

export function normalizeAntiphons(a: z.infer<typeof antiphonsSchema>) {
  return {
    ...(a?.entrada ? { entrance: a.entrada } : {}),
    ...(a?.comunhao ? { communion: a.comunhao } : {}),
  };
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
