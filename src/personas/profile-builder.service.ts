import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { OnboardingStatus, OnboardingSessionStatus } from '@prisma/client';

@Injectable()
export class ProfileBuilder {
    private readonly logger = new Logger(ProfileBuilder.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Finalizes the onboarding by building the user's persona and updating status.
     * Called when a founder approves the session.
     */
    async finalize(sessionId: string): Promise<void> {
        try {
            const session = await this.prisma.onboardingSession.findUnique({
                where: { id: sessionId },
            });

            if (!session || session.status !== OnboardingSessionStatus.pending_approval) {
                throw new Error('Onboarding session not found or not in pending_approval state');
            }

            const profileData = session.builtProfileJson as any;

            // Update user record: Promote to member and finalize profile
            await this.prisma.user.update({
                where: { telegramId: session.telegramId },
                data: {
                    displayName: profileData.displayName || 'Newcomer',
                    onboardingStatus: OnboardingStatus.approved,
                    role: 'member', // Promote from guest
                    personaJson: {
                        role: profileData.role,
                        technicalTone: profileData.technicalTone,
                        summary: profileData.summary,
                    },
                },
            });

            // Mark session as approved
            await this.prisma.onboardingSession.update({
                where: { id: sessionId },
                data: { status: OnboardingSessionStatus.approved },
            });

            this.logger.log(`[APPROVAL_TRACE] User ${session.telegramId} session approved. Profile finalized: ${JSON.stringify(profileData)}`);
        } catch (error) {
            this.logger.error(`Failed to finalize profile for session ${sessionId}`, error);
            throw error;
        }
    }

    /**
     * Rejects an onboarding session.
     */
    async reject(sessionId: string): Promise<void> {
        try {
            await this.prisma.onboardingSession.update({
                where: { id: sessionId },
                data: { status: OnboardingSessionStatus.denied },
            });

            const session = await this.prisma.onboardingSession.findUnique({
                where: { id: sessionId },
            });

            if (session) {
                await this.prisma.user.update({
                    where: { telegramId: session.telegramId },
                    data: { onboardingStatus: OnboardingStatus.denied },
                });
            }

            this.logger.log(`[APPROVAL_TRACE] Onboarding session ${sessionId} for user ${session?.telegramId} rejected.`);
        } catch (error) {
            this.logger.error(`Failed to reject session ${sessionId}`, error);
            throw error;
        }
    }
}
