import type { GuildSettings, Prisma, PrismaClient } from '@prisma/client';
import type { AuditService } from '../audit/audit-service.js';

export type { GuildSettings };

export interface SettingsDefaults {
  locale: string;
  timezone: string;
  liturgyApiVersion: string;
  bibleAutoReferences: boolean;
}

/** Configurações por servidor, com cache curto. Toda leitura/escrita é por guildId. */
export class GuildSettingsService {
  private readonly cache = new Map<string, { value: GuildSettings; at: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly defaults: SettingsDefaults,
    private readonly ttlMs = 60_000,
  ) {}

  async get(guildId: string): Promise<GuildSettings> {
    const hit = this.cache.get(guildId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = await this.prisma.guildSettings.upsert({
      where: { guildId },
      update: {},
      create: { guildId, ...this.defaults },
    });
    this.cache.set(guildId, { value, at: Date.now() });
    return value;
  }

  async update(
    guildId: string,
    actorUserId: string,
    patch: Prisma.GuildSettingsUpdateInput,
  ): Promise<GuildSettings> {
    await this.get(guildId);
    const value = await this.prisma.guildSettings.update({ where: { guildId }, data: patch });
    this.cache.set(guildId, { value, at: Date.now() });
    await this.audit.record({
      guildId,
      action: 'settings.update',
      actorUserId,
      metadata: { patch: patch as Record<string, unknown> },
    });
    return value;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
