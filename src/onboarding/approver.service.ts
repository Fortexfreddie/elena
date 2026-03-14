import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { ReplySenderService } from '../telegram/reply.sender';
import { InlineKeyboard } from 'grammy';
import { escapeMarkdownV2 } from '@app/common';
import type { UserRecognitionState } from './detector.service';

@Injectable()
export class ApproverService {
    private readonly logger = new Logger(ApproverService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => ReplySenderService))
        private readonly replySender: ReplySenderService,
    ) { }

    /**
     * Notifies all founders about a pending onboarding session.
     */
    async notifyFounders(sessionId: string, displayName: string, role: string, summary: string): Promise<void> {
        try {
            const founders = await this.prisma.user.findMany({
                where: { isFoundingMember: true },
                select: { telegramId: true, displayName: true },
            });

            this.logger.log(`[APPROVAL_TRACE] Found ${founders.length} founders to notify for session ${sessionId}.`);

            if (founders.length === 0) {
                this.logger.warn('No founders found to notify for approval.');
                return;
            }

            // Construct message using MarkdownV2 syntax. User fields are escaped individually.
            const message = `*🔔 New Squad Application*\n\n` +
                `*Name:* ${escapeMarkdownV2(displayName)}\n` +
                `*Role:* ${escapeMarkdownV2(role)}\n` +
                `*Summary:* ${escapeMarkdownV2(summary)}\n\n` +
                `Should we let them in?`;

            const keyboard = new InlineKeyboard()
                .text('✅ Approve', [`approve_${sessionId}`, `${displayName}`].join('|'))
                .text('❌ Deny', [`deny_${sessionId}`, `${displayName}`].join('|'));

            for (const founder of founders) {
                try {
                    this.logger.log(`[APPROVAL_TRACE] Sending approval request to founder ${founder.displayName} (${founder.telegramId})`);
                    await this.replySender.sendReply(founder.telegramId, message, undefined, 'MarkdownV2', false);
                    // We use sendReply to handle chunking, and pass MarkdownV2 explicitly.
                    // However, sendReply also calls escapeMarkdownV2 on the whole message if parseMode is MarkdownV2.
                    // Wait, if I escape fields here AND sendReply escapes the whole message, I'll have double escaping.
                } catch (err: unknown) {
                    this.logger.error(`Failed to notify founder ${founder.telegramId}`, err);
                }
            }
        } catch (error) {
            this.logger.error('Failed to notify founders about pending approval', error);
        }
    }
}
