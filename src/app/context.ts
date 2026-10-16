import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import type { Logger } from '../shared/logger.js';
import type { GuildSettingsService } from '../modules/guild-settings/settings-service.js';
import type { AuditService } from '../modules/audit/audit-service.js';
import type { BibleService } from '../modules/bible/application/bible-service.js';
import type { AutoReferenceService } from '../modules/bible/application/auto-reference-service.js';
import type { LiturgyService } from '../modules/liturgy/application/liturgy-service.js';
import type { MuteService } from '../modules/moderation/application/mute-service.js';
import type { ModLogService } from '../modules/moderation/application/mod-log.js';
import type { ScheduleService } from '../modules/scheduling/application/schedule-service.js';
import type { MessageRenderer } from '../modules/scheduling/application/delivery-service.js';
import type { SaintsService } from '../modules/calendar/application/saints-service.js';

/** Dependências compartilhadas pelos handlers. Handlers são finos; a lógica vive nos serviços. */
export interface AppContext {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  settings: GuildSettingsService;
  audit: AuditService;
  bible: BibleService;
  autoReferences: AutoReferenceService;
  liturgy: LiturgyService;
  /** null quando LITCAL_ENABLED=false. */
  saints: SaintsService | null;
  mutes: MuteService;
  modLog: ModLogService;
  schedules: ScheduleService;
  renderer: MessageRenderer;
}
