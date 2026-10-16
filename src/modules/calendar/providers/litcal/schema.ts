import { z } from 'zod';

/**
 * Evento do Liturgical Calendar API (LitCal) — campos verificados no esquema
 * jsondata/schemas/LitCal.json do projeto (commit e2846cb, 2026-10-14). Só
 * validamos o que usamos; o resto é ignorado.
 */
export const litcalEventSchema = z.object({
  event_key: z.string(),
  name: z.string().min(1),
  color: z.array(z.string()).default([]),
  color_lcl: z.array(z.string()).optional(),
  /** 0 féria · 1 comemoração · 2 memória facultativa · 3 memória · 4 festa · 5 festa do Senhor · 6 solenidade · 7 superior a solenidade */
  grade: z.number().int().min(0).max(7),
  grade_lcl: z.string().optional(),
  grade_display: z.string().nullish(),
  common_lcl: z.string().optional(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  is_vigil_mass: z.boolean().optional(),
  liturgical_season: z.string().optional(),
  liturgical_season_lcl: z.string().optional(),
  holy_day_of_obligation: z.boolean().optional(),
});

export const litcalResponseSchema = z.object({
  litcal: z.array(litcalEventSchema),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type LitcalEvent = z.infer<typeof litcalEventSchema>;
