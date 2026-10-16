import { z } from 'zod';
import { antiphonsSchema, lenientArray, optText, prayersSchema } from '../common.js';

const readingSchema = z.object({ referencia: optText, titulo: optText, texto: optText });
const psalmSchema = z.object({ referencia: optText, refrao: optText, texto: optText });
const extraReadingSchema = z.object({ tipo: optText, referencia: optText, titulo: optText, texto: optText });

/** Resposta de GET /v2/ (documentação v2 + tolerância a campos ausentes). */
export const v2DaySchema = z.object({
  data: z.string(),
  liturgia: z.string().min(1),
  cor: optText,
  oracoes: prayersSchema,
  leituras: z
    .object({
      primeiraLeitura: lenientArray(readingSchema),
      salmo: lenientArray(psalmSchema),
      segundaLeitura: lenientArray(readingSchema),
      evangelho: lenientArray(readingSchema),
      extras: lenientArray(extraReadingSchema),
    })
    .partial()
    .nullish(),
  antifonas: antiphonsSchema,
});

export type V2Day = z.infer<typeof v2DaySchema>;
