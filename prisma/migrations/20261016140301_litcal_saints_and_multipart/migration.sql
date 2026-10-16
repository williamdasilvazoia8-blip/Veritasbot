-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "romanCalendarId" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "romanCalendarLocale" TEXT NOT NULL DEFAULT 'la';

-- AlterTable
ALTER TABLE "ScheduledDelivery" ADD COLUMN     "partsSent" INTEGER NOT NULL DEFAULT 0;
