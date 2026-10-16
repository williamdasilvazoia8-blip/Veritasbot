import { z } from 'zod';
import { IANAZone } from 'luxon';

const boolFromString = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const timezone = z.string().refine((tz) => IANAZone.isValidZone(tz), 'Fuso horário IANA inválido');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  /** Se definido, comandos são registrados só neste servidor (desenvolvimento). */
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  DEFAULT_LOCALE: z.enum(['pt-BR', 'pt-PT']).default('pt-BR'),
  DEFAULT_TIMEZONE: timezone.default('America/Sao_Paulo'),
  LITURGIA_API_BASE_URL: z.string().url().default('https://liturgia.up.railway.app'),
  LITURGIA_API_VERSION: z.enum(['v2', 'v3']).default('v2'),
  /** v3 é beta: só pode ser escolhida por servidores se esta flag estiver ligada. */
  LITURGIA_V3_ENABLED: boolFromString.default(false),
  LITURGIA_API_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
  LITURGIA_MAX_RESPONSE_BYTES: z.coerce.number().int().min(10_000).default(2_000_000),
  /** Liturgical Calendar API (santos do dia pelo Calendário Romano). */
  LITCAL_ENABLED: boolFromString.default(true),
  LITCAL_API_BASE_URL: z.string().url().default('https://litcal.johnromanodorazio.com/api/v5'),
  LITCAL_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(15_000),
  LITCAL_MAX_RESPONSE_BYTES: z.coerce.number().int().min(100_000).default(8_000_000),
  BIBLE_EDITION_ID: z.string().min(1).default('matos-soares-1956'),
  BIBLE_AUTO_REFERENCES_ENABLED: boolFromString.default(true),
  BIBLE_QUOTATION_MATCHING_ENABLED: boolFromString.default(false),
  /** Atraso máximo (minutos) para entregar um agendamento perdido durante indisponibilidade. */
  SCHEDULE_MISSED_GRACE_MINUTES: z.coerce.number().int().min(0).default(360),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Cloud Run (e similares) informam a porta em PORT; HEALTH_PORT explícito tem prioridade.
  const parsed = envSchema.safeParse({ ...source, HEALTH_PORT: source.HEALTH_PORT ?? source.PORT });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}
