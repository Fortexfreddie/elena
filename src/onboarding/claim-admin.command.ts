import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { UserRole, OnboardingStatus } from '@prisma/client';

@Injectable()
export class ClaimAdminCommand {
    private readonly logger = new Logger(ClaimAdminCommand.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Attempts to claim the first superadmin spot. 
     * Success only if NO superadmins exist in the DB.
     * @returns {Promise<string>} result message.
     */
    async execute(telegramId: string, displayName: string, username?: string): Promise<string> {
        try {
            // 1. Check Superadmin count
            const superadminCount = await this.prisma.user.count({
                where: { role: UserRole.superadmin },
            });

            // Bootstrap: First ever user becomes Superadmin
            if (superadminCount === 0) {
                await this.prisma.user.upsert({
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
                this.logger.log(`User ${telegramId} (${displayName}) claimed the first Superadmin spot.`);
                return '✅ Access Granted. You are now the Superadmin and Founding Member of Elena.';
            }

            // 2. If Superadmin already exists, check if user is an approved member
            const user = await this.prisma.user.findUnique({
                where: { telegramId },
                select: { role: true, onboardingStatus: true },
            });

            if (!user || user.onboardingStatus !== OnboardingStatus.approved) {
                this.logger.warn(`User ${telegramId} tried to claim admin without member approval.`);
                return '❌ Access Denied. You must be an approved member of the squad to claim admin status.';
            }

            if (user.role === UserRole.superadmin || user.role === UserRole.admin) {
                return '⚠️ You already have administrative privileges.';
            }

            // 3. Check Admin count (Limit: 2)
            const adminCount = await this.prisma.user.count({
                where: { role: UserRole.admin },
            });

            if (adminCount >= 2) {
                this.logger.warn(`User ${telegramId} tried to claim admin, but capacity (2) is full.`);
                return '❌ Admin capacity reached. All spots are filled.';
            }

            // 4. Upgrade Member to Admin
            await this.prisma.user.update({
                where: { telegramId },
                data: { role: UserRole.admin },
            });

            this.logger.log(`User ${telegramId} (${displayName}) successfully claimed an Admin spot.`);
            return '✅ Access Granted. You have been promoted to Admin.';
        } catch (error) {
            this.logger.error('Failed to execute claim-admin command', error);
            return '❌ System error during admin claim.';
        }
    }
}
