import type { Prisma, PrismaClient } from '@prisma/client';

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: {
    guildId: string;
    action: string;
    actorUserId: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        guildId: entry.guildId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
