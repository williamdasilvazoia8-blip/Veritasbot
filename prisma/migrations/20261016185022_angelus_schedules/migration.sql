-- AlterEnum
ALTER TYPE "ScheduleKind" ADD VALUE 'ANGELUS';

-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledMessage_guildId_groupId_idx" ON "ScheduledMessage"("guildId", "groupId");
