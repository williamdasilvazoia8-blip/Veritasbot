import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'veritasbot' },
  // Nunca registrar conteúdo completo de mensagens de usuários.
  redact: ['*.content', '*.token', 'token'],
});

export type Logger = typeof logger;
