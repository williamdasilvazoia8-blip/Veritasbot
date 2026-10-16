-- CreateEnum
CREATE TYPE "ModerationType" AS ENUM ('MUTE', 'UNMUTE', 'KICK', 'BAN', 'UNBAN', 'PURGE');

-- CreateEnum
CREATE TYPE "MuteMechanism" AS ENUM ('NATIVE_TIMEOUT', 'MUTED_ROLE', 'NONE');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'SUPERSEDED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('TEXT', 'LITURGY_DAILY');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CANCELED', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "bibleAutoReferences" BOOLEAN NOT NULL DEFAULT true,
    "bibleAllowedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bibleExcludedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bibleMaxReferences" INTEGER NOT NULL DEFAULT 3,
    "bibleCooldownSeconds" INTEGER NOT NULL DEFAULT 5,
    "psalmNumbering" TEXT NOT NULL DEFAULT 'vulgate',
    "allowWebhookMessages" BOOLEAN NOT NULL DEFAULT false,
    "quotationMatchingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quotationMinWords" INTEGER NOT NULL DEFAULT 10,
    "quotationChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "liturgyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "liturgyApiVersion" TEXT NOT NULL DEFAULT 'v2',
    "calendarVariant" TEXT NOT NULL DEFAULT 'general-roman-of',
    "modLogChannelId" TEXT,
    "mutedRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "BibleEdition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRevision" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rightsStatus" TEXT NOT NULL,
    "versificationScheme" TEXT NOT NULL,
    "verseCount" INTEGER NOT NULL,
    "anomalyReport" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BibleEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibleVerse" (
    "id" SERIAL NOT NULL,
    "editionId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "BibleVerse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" "ModerationType" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mechanism" "MuteMechanism" NOT NULL DEFAULT 'NONE',
    "status" "ModerationStatus" NOT NULL,
    "durationInput" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "kind" "ScheduleKind" NOT NULL DEFAULT 'TEXT',
    "payload" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "startLocal" TEXT NOT NULL,
    "recurrence" "Recurrence" NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "nextRunAt" TIMESTAMP(3),
    "nextOccurrenceKey" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledDelivery" (
    "id" TEXT NOT NULL,
    "scheduledMessageId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "discordMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiturgyDaySummary" (
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "celebrationName" TEXT NOT NULL,
    "color" TEXT,
    "payloadHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiturgyDaySummary_pkey" PRIMARY KEY ("source","version","date")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BibleVerse_editionId_bookId_chapter_verse_idx" ON "BibleVerse"("editionId", "bookId", "chapter", "verse");

-- CreateIndex
CREATE UNIQUE INDEX "BibleVerse_editionId_bookId_chapter_seq_key" ON "BibleVerse"("editionId", "bookId", "chapter", "seq");

-- CreateIndex
CREATE INDEX "ModerationAction_guildId_targetUserId_status_idx" ON "ModerationAction"("guildId", "targetUserId", "status");

-- CreateIndex
CREATE INDEX "ModerationAction_status_expiresAt_idx" ON "ModerationAction"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_guildId_status_idx" ON "ScheduledMessage"("guildId", "status");

-- CreateIndex
CREATE INDEX "ScheduledMessage_status_nextRunAt_idx" ON "ScheduledMessage"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledDelivery_scheduledMessageId_occurrenceKey_key" ON "ScheduledDelivery"("scheduledMessageId", "occurrenceKey");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- AddForeignKey
ALTER TABLE "BibleVerse" ADD CONSTRAINT "BibleVerse_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "BibleEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledDelivery" ADD CONSTRAINT "ScheduledDelivery_scheduledMessageId_fkey" FOREIGN KEY ("scheduledMessageId") REFERENCES "ScheduledMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
