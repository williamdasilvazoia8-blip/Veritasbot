import { Client, Events, GatewayIntentBits, Partials, Status } from 'discord.js';
import { Redis } from 'ioredis';
import { loadEnv } from './config/env.js';
import { redisOptions } from './shared/redis-options.js';
import { logger } from './shared/logger.js';
import { createPrisma } from './database/prisma.js';
import { AuditService } from './modules/audit/audit-service.js';
import { GuildSettingsService } from './modules/guild-settings/settings-service.js';
import { BibleService } from './modules/bible/application/bible-service.js';
import { AutoReferenceService } from './modules/bible/application/auto-reference-service.js';
import { onMessageCreate } from './modules/bible/events/message-create.js';
import { LiturgyService } from './modules/liturgy/application/liturgy-service.js';
import {
  LiturgiaDiariaV2Client,
  LiturgiaDiariaV3Client,
} from './modules/liturgy/providers/liturgia-diaria/client.js';
import { BullMqJobScheduler } from './jobs/bullmq-scheduler.js';
import { MuteService } from './modules/moderation/application/mute-service.js';
import { DiscordMuteGateway } from './modules/moderation/application/discord-mute-gateway.js';
import { ModLogService } from './modules/moderation/application/mod-log.js';
import { onGuildMemberAdd, onGuildMemberUpdate } from './modules/moderation/events/member-events.js';
import { ScheduleService } from './modules/scheduling/application/schedule-service.js';
import { DeliveryService } from './modules/scheduling/application/delivery-service.js';
import { DiscordMessageSender } from './modules/scheduling/application/discord-sender.js';
import { ScheduledMessageRenderer } from './modules/scheduling/application/renderer.js';
import { routeInteraction } from './bot/interaction-router.js';
import { LitcalClient } from './modules/calendar/providers/litcal/client.js';
import { SaintsService } from './modules/calendar/application/saints-service.js';
import { startHealthServer } from './app/health.js';
import type { AppContext } from './app/context.js';

const RECONCILE_INTERVAL_MS = 10 * 60_000;

async function main() {
  const env = loadEnv();
  logger.level = env.LOG_LEVEL;
  const prisma = createPrisma();
  await prisma.$connect();

  const connection = new Redis(env.REDIS_URL, redisOptions(env.REDIS_URL));
  const jobs = new BullMqJobScheduler(connection);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Privilegiada: precisa estar ativada no Developer Portal (Bot → Message Content Intent).
      GatewayIntentBits.MessageContent,
      // Privilegiada: necessária para reaplicar mutes na reentrada e detectar remoções manuais.
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.GuildMember],
    allowedMentions: { parse: [], repliedUser: false },
  });

  const audit = new AuditService(prisma);
  const settings = new GuildSettingsService(prisma, audit, {
    locale: env.DEFAULT_LOCALE,
    timezone: env.DEFAULT_TIMEZONE,
    liturgyApiVersion: env.LITURGIA_API_VERSION,
    bibleAutoReferences: env.BIBLE_AUTO_REFERENCES_ENABLED,
  });
  const bible = await BibleService.load(prisma, env.BIBLE_EDITION_ID, logger);
  const autoReferences = new AutoReferenceService(bible.provider, {
    maxVersesPerPassage: 20,
    globalEnabled: env.BIBLE_AUTO_REFERENCES_ENABLED,
    quotationGloballyEnabled: env.BIBLE_QUOTATION_MATCHING_ENABLED,
    getQuotationMatcher: () => bible.getQuotationMatcher(),
  });
  const http = {
    baseUrl: env.LITURGIA_API_BASE_URL,
    timeoutMs: env.LITURGIA_API_TIMEOUT_MS,
    maxBytes: env.LITURGIA_MAX_RESPONSE_BYTES,
    onRetry: (info: { attempt: number; delayMs: number; reason: string }) =>
      logger.info(info, 'Nova tentativa na API de liturgia'),
  };
  const liturgy = new LiturgyService({
    providers: {
      v2: new LiturgiaDiariaV2Client(http),
      ...(env.LITURGIA_V3_ENABLED ? { v3: new LiturgiaDiariaV3Client(http) } : {}),
    },
    defaultVersion: env.LITURGIA_API_VERSION === 'v3' && env.LITURGIA_V3_ENABLED ? 'v3' : 'v2',
    v3Enabled: env.LITURGIA_V3_ENABLED,
    prisma,
    logger,
  });
  const saints = env.LITCAL_ENABLED
    ? new SaintsService(
        new LitcalClient({
          baseUrl: env.LITCAL_API_BASE_URL,
          timeoutMs: env.LITCAL_TIMEOUT_MS,
          maxBytes: env.LITCAL_MAX_RESPONSE_BYTES,
        }),
        { logger },
      )
    : null;
  const modLog = new ModLogService(client, settings, logger);
  const mutes = new MuteService(prisma, new DiscordMuteGateway(client), jobs, logger);
  const schedules = new ScheduleService(prisma, jobs, audit);
  const renderer = new ScheduledMessageRenderer(settings, liturgy, saints);
  const delivery = new DeliveryService(prisma, schedules, jobs, new DiscordMessageSender(client), renderer, {
    logger,
    onPermanentFailure: async (s, error) =>
      modLog.post({
        guildId: s.guildId,
        title: '⚠️ Agendamento suspenso',
        color: 0xc62828,
        fields: [
          { name: 'Agendamento', value: `\`${s.id}\` → <#${s.channelId}>` },
          { name: 'Erro', value: error },
        ],
      }),
  });

  const ctx: AppContext = {
    env,
    logger,
    prisma,
    settings,
    audit,
    bible,
    autoReferences,
    liturgy,
    saints,
    mutes,
    modLog,
    schedules,
    renderer,
  };

  client.on(
    Events.MessageCreate,
    (m) =>
      void onMessageCreate(m, ctx).catch((err) =>
        logger.error({ err, guildId: m.guildId }, 'Erro no handler de mensagens'),
      ),
  );
  client.on(Events.InteractionCreate, (i) => void routeInteraction(i, ctx));
  client.on(
    Events.GuildMemberAdd,
    (m) => void onGuildMemberAdd(m, ctx).catch((err) => logger.error({ err }, 'Erro em GuildMemberAdd')),
  );
  client.on(
    Events.GuildMemberUpdate,
    (o, n) =>
      void onGuildMemberUpdate(o, n, ctx).catch((err) => logger.error({ err }, 'Erro em GuildMemberUpdate')),
  );
  client.on(Events.Error, (err) => logger.error({ err }, 'Erro do cliente Discord'));
  client.on(Events.ShardDisconnect, (_e, id) => logger.warn({ shard: id }, 'Gateway desconectado'));
  client.on(Events.ShardResume, (id) => logger.info({ shard: id }, 'Gateway retomado'));

  let worker: ReturnType<BullMqJobScheduler['startWorker']> | undefined;
  let reconcileTimer: NodeJS.Timeout | undefined;
  const reconcile = async () => {
    const m = await mutes.reconcile();
    const s = await schedules.reconcile(env.SCHEDULE_MISSED_GRACE_MINUTES * 60_000);
    logger.info({ mutes: m, schedules: s }, 'Reconciliação concluída');
  };

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'Bot conectado');
    // O worker só começa depois que o cliente está pronto (precisa dele para enviar).
    worker = jobs.startWorker(
      connection,
      {
        'mute-release': async ({ actionId }) => void (await mutes.release(actionId)),
        'schedule-delivery': async ({ scheduleId, occurrenceKey }) =>
          void (await delivery.deliver(scheduleId, occurrenceKey)),
      },
      logger,
    );
    await reconcile().catch((err) => logger.error({ err }, 'Falha na reconciliação inicial'));
    reconcileTimer = setInterval(
      () => void reconcile().catch((err) => logger.error({ err }, 'Falha na reconciliação')),
      RECONCILE_INTERVAL_MS,
    );
  });

  const health = startHealthServer(env.HEALTH_PORT, async () => ({
    discord: client.ws.status === Status.Ready,
    database: await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis: await connection
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false),
    bibleLoaded: Boolean(bible.provider.edition),
  }));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Encerrando com segurança');
    clearInterval(reconcileTimer);
    health.close();
    await worker?.close().catch(() => undefined);
    await jobs.close().catch(() => undefined);
    await client.destroy().catch(() => undefined);
    await connection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha fatal na inicialização');
  process.exit(1);
});
