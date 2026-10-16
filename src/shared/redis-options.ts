import type { RedisOptions } from 'ioredis';

/**
 * Opções do ioredis para BullMQ. Em `rediss://` (TLS), a verificação do certificado
 * fica ligada por padrão, exceto no Heroku (variável DYNO), cujo Redis usa certificado
 * autoassinado — é o que a documentação do Heroku orienta. REDIS_TLS_REJECT_UNAUTHORIZED
 * ("true"/"false") sobrepõe a deteção.
 */
export function redisOptions(url: string, env: NodeJS.ProcessEnv = process.env): RedisOptions {
  const options: RedisOptions = { maxRetriesPerRequest: null };
  if (url.startsWith('rediss://')) {
    const explicit = env.REDIS_TLS_REJECT_UNAUTHORIZED;
    const rejectUnauthorized = explicit !== undefined ? explicit !== 'false' : !env.DYNO;
    options.tls = { rejectUnauthorized };
  }
  return options;
}
