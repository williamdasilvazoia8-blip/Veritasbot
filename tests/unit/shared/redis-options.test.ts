import { describe, expect, it } from 'vitest';
import { redisOptions } from '../../../src/shared/redis-options.js';

describe('redisOptions', () => {
  it('sem TLS em redis://', () => {
    expect(redisOptions('redis://localhost:6379', {})).toEqual({ maxRetriesPerRequest: null });
  });
  it('TLS verificado por padrão fora do Heroku', () => {
    expect(redisOptions('rediss://h:6380', {}).tls).toEqual({ rejectUnauthorized: true });
  });
  it('no Heroku (DYNO) aceita o certificado autoassinado do Redis gerido', () => {
    expect(redisOptions('rediss://h:6380', { DYNO: 'worker.1' }).tls).toEqual({ rejectUnauthorized: false });
  });
  it('variável explícita tem prioridade', () => {
    expect(
      redisOptions('rediss://h:6380', { DYNO: 'worker.1', REDIS_TLS_REJECT_UNAUTHORIZED: 'true' }).tls,
    ).toEqual({ rejectUnauthorized: true });
    expect(redisOptions('rediss://h:6380', { REDIS_TLS_REJECT_UNAUTHORIZED: 'false' }).tls).toEqual({
      rejectUnauthorized: false,
    });
  });
});
