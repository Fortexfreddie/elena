-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "targetType" TEXT NOT NULL DEFAULT 'group',
ADD COLUMN     "targetUserId" TEXT;
