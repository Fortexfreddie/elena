import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { UserRole, OnboardingStatus, OnboardingSessionStatus } from '@prisma/client';

@Injectable()
export class ClaimAdminCommand {
  private readonly logger = new Logger(ClaimAdminCommand.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempts to claim the first superadmin spot.
   * Success only if NO superadmins exist in the DB.
   * @returns {Promise<string>} result message.
   */
  async execute(
    telegramId: string,
    displayName: string,
    username?: string,
  ): Promise<string> {
    try {
      // 1. Check Superadmin count using an atomic transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const superadminCount = await tx.user.count({
          where: { role: UserRole.superadmin },
        });

        if (superadminCount === 0) {
          await tx.user.upsert({
            where: { telegramId },
            update: {
              role: UserRole.superadmin,
              isFoundingMember: true,
              onboardingStatus: OnboardingStatus.approved,
            },
            create: {
              telegramId,
              displayName,
              username,
              role: UserRole.superadmin,
              isFoundingMember: true,
              onboardingStatus: OnboardingStatus.approved,
            },
          });
          
          await tx.onboardingSession.updateMany({
            where: { telegramId, status: { in: [OnboardingSessionStatus.in_progress, OnboardingSessionStatus.pending_approval] } },
            data: { status: OnboardingSessionStatus.approved },
          });

          return '✅ Access Granted. You are now the Superadmin and Founding Member of Elena.';
        }
        return null;
      });

      if (result) {
        this.logger.log(
          `User ${telegramId} (${displayName}) claimed the first Superadmin spot.`,
        );
        return result;
      }

      // 2. If Superadmin already exists, check if user is an approved member inside a transaction
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { telegramId },
          select: { role: true, onboardingStatus: true },
        });

        if (!user || user.onboardingStatus !== OnboardingStatus.approved) {
          this.logger.warn(
            `User ${telegramId} tried to claim admin without member approval.`,
          );
          return '❌ Access Denied. You must be an approved member of the squad to claim admin status.';
        }

        if (user.role === UserRole.superadmin || user.role === UserRole.admin) {
          return '⚠️ You already have administrative privileges.';
        }

        // 3. Check Admin count (Limit: 2)
        const adminCount = await tx.user.count({
          where: { role: UserRole.admin },
        });

        if (adminCount >= 2) {
          this.logger.warn(
            `User ${telegramId} tried to claim admin, but capacity (2) is full.`,
          );
          return '❌ Admin capacity reached. All spots are filled.';
        }

        // 4. Upgrade Member to Admin
        await tx.user.update({
          where: { telegramId },
          data: { role: UserRole.admin },
        });

        this.logger.log(
          `User ${telegramId} (${displayName}) successfully claimed an Admin spot.`,
        );
        return '✅ Access Granted. You have been promoted to Admin.';
      });
    } catch (error) {
      this.logger.error('Failed to execute claim-admin command', error);
      return '❌ System error during admin claim.';
    }
  }
}
