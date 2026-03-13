import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { OnboardingStatus } from '@prisma/client';

export type UserRecognitionState = 'known' | 'pending' | 'unknown';

@Injectable()
export class OnboardingDetector {
    private readonly logger = new Logger(OnboardingDetector.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Checks the recognition state of a Telegram user.
     * @param telegramId The Telegram user ID string.
     * @returns 'known' for approved members, 'pending' for users in the interview flow, 'unknown' for strangers.
     */
    async check(telegramId: string): Promise<UserRecognitionState> {
        try {
            const user = await this.prisma.user.findUnique({
                where: { telegramId },
                select: { onboardingStatus: true },
            });

            if (!user) {
                this.logger.log(`[ONBOARDING_TRACE] User ${telegramId} is entirely new to Elena.`);
                return 'unknown';
            }

            this.logger.log(`[ONBOARDING_TRACE] User ${telegramId} status from DB: ${user.onboardingStatus}`);

            switch (user.onboardingStatus) {
                case OnboardingStatus.approved:
                    return 'known';
                case OnboardingStatus.pending:
                    return 'pending';
                case OnboardingStatus.denied:
                    // Denied users are treated as unknown to prevent them from interacting further,
                    // but we could also add an explicit 'denied' state if we want to block them harder.
                    return 'unknown';
                default:
                    return 'unknown';
            }
        } catch (error) {
            this.logger.error(`Failed to check user recognition for ${telegramId}`, error);
            // Fallback to unknown if database fails; better to be safe than leak data
            return 'unknown';
        }
    }
}
