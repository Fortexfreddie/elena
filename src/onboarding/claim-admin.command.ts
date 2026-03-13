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
            // 1. Check if any superadmin exists
            const superadminCount = await this.prisma.user.count({
                where: { role: UserRole.superadmin },
            });

            if (superadminCount > 0) {
                this.logger.warn(`User ${telegramId} tried to claim admin, but an admin already exists.`);
                return '❌ Superadmin already exists. Access denied.';
            }

            // 2. Claim the spot
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

            this.logger.log(`User ${telegramId} (${displayName}) successfully claimed the first superadmin spot.`);
            return '✅ Access Granted. You are now the Superadmin and Founding Member of Elena.';
        } catch (error) {
            this.logger.error('Failed to execute claim-admin command', error);
            return '❌ System error during admin claim.';
        }
    }
}
