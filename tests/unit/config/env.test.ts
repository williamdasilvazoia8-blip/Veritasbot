import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.js';

const base = {
  DISCORD_TOKEN: 't',
  DISCORD_CLIENT_ID: '123456789012345678',
  DATABASE_URL: 'postgresql://x@localhost/db',
};

describe('loadEnv', () => {
  it('usa PORT (Cloud Run) quando HEALTH_PORT não é informado', () => {
    expect(loadEnv({ ...base, PORT: '9090' }).HEALTH_PORT).toBe(9090);
  });
  it('HEALTH_PORT explícito tem prioridade; padrão 8080', () => {
    expect(loadEnv({ ...base, PORT: '9090', HEALTH_PORT: '7000' }).HEALTH_PORT).toBe(7000);
    expect(loadEnv(base).HEALTH_PORT).toBe(8080);
  });
  it('rejeita configuração inválida com mensagem clara', () => {
    expect(() => loadEnv({ ...base, DEFAULT_TIMEZONE: 'Lua/Base' })).toThrow(/DEFAULT_TIMEZONE/);
  });
});

describe('REFERENCE_TEXTS_GUILD_IDS', () => {
  it('vazio = todos; lista separada por vírgulas; rejeita IDs inválidos', () => {
    expect(loadEnv(base).REFERENCE_TEXTS_GUILD_IDS).toEqual([]);
    expect(
      loadEnv({ ...base, REFERENCE_TEXTS_GUILD_IDS: '123456789012345678, 223456789012345678' })
        .REFERENCE_TEXTS_GUILD_IDS,
    ).toEqual(['123456789012345678', '223456789012345678']);
    expect(() => loadEnv({ ...base, REFERENCE_TEXTS_GUILD_IDS: 'abc' })).toThrow(/REFERENCE_TEXTS_GUILD_IDS/);
  });
});
