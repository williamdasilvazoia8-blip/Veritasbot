import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Testes de integração só rodam com TEST_DATABASE_URL (PostgreSQL descartável). */
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

export function testPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://unused' } } });
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ScheduledDelivery", "ScheduledMessage", "ModerationAction", "AuditLog", "GuildSettings", "LiturgyDaySummary", "BibleVerse", "BibleEdition" CASCADE',
  );
}
