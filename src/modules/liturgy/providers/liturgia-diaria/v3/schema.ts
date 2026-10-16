import { z } from 'zod';
import { antiphonsSchema, lenientArray, optText, prayersSchema } from '../common.js';

const optionSchema = z.object({ referencia: optText, titulo: optText, refrao: optText, texto: optText });

const readingSchema = z.object({
  ordem: z.number().int(),
  tipo: z.string(),
  rotulo: optText,
  opcoes: lenientArray(optionSchema),
});

const celebrationSchema = z.object({
  id: optText,
  liturgia: z.string().min(1),
  cor: optText,
  principal: z.boolean().optional(),
  oracoes: prayersSchema,
  antifonas: antiphonsSchema,
  leituras: lenientArray(readingSchema),
});

/** Resposta de GET /v3/ (BETA — documentação v3). */
export const v3DaySchema = z.object({
  data: z.string(),
  celebracoes: z.array(celebrationSchema).min(1),
});

export type V3Day = z.infer<typeof v3DaySchema>;
