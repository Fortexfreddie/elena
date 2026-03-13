import {
    Controller,
    Post,
    Body,
    UseGuards,
    Logger,
    HttpCode,
    Inject,
    forwardRef
} from '@nestjs/common';
import { TelegramSecretGuard } from './guards/telegram-secret.guard';
import { parseMessage } from './message.parser';
import { shouldProcess } from './heuristic-gate';
import { ReactionSenderService } from './reaction.sender';
import { ReplySenderService } from './reply.sender';
import { QueueService } from '../queue/queue.service';
import { ProfileBuilder } from '../personas/profile-builder.service';
import { PrismaService } from '@app/database';
import { ClaimAdminCommand } from '../onboarding/claim-admin.command';
import type { TelegramUpdate } from '@app/common/types/telegram.types';
import { UpstashRedisService } from '@app/common';

/**
 * Webhook controller for incoming Telegram updates.
 *
 * Pipeline:
 *   0. update_id idempotency gate (FIRST — atomic SETNX)
 *   1. TelegramSecretGuard (401 if wrong header)
 *   2. Check /confirm_ or /cancel_ prefix → HITL resume
 *   3. message.parser.ts → ParsedMessage
 *   4. Stage 1 heuristic gate (zero cost)
 *   5. reaction.sender (thinking emoji)
 *   6. QueueService.addMessageJob
 *   7. return { ok: true }
 *
 * Grammy is NOT called here. bot.handleUpdate() is NEVER called.
 * try/catch wraps the pipeline — on failure, redis.del releases the update_id lock.
 */
@Controller()
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);
    private botId: number | null = null;

    constructor(
        private readonly reactionSender: ReactionSenderService,
        private readonly replySender: ReplySenderService,
        private readonly queueService: QueueService,
        private readonly redisService: UpstashRedisService,
        private readonly profileBuilder: ProfileBuilder,
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => ClaimAdminCommand))
        private readonly claimAdmin: ClaimAdminCommand,
    ) {}

    @Post('/webhook')
    @UseGuards(TelegramSecretGuard)
    @HttpCode(200)
    async handleWebhook(
        @Body() update: TelegramUpdate,
    ): Promise<{ ok: boolean }> {
        const updateId = update.update_id;

        // Step 0: Atomic update_id idempotency gate
        // SETNX with TTL in a single command — no race condition
        const isNew = await this.redisService.client.set(`update:${String(updateId)}`, '1', {
            nx: true,
            ex: 3600,
        });

        if (!isNew) {
            // Duplicate — Telegram retry. Drop silently.
            return { ok: true };
        }

        try {
            // Step 0.5: Check for Callback Queries (Approval Flow)
            if (update.callback_query) {
                const callbackData = update.callback_query.data;
                const fromId = String(update.callback_query.from.id);

                if (callbackData && (callbackData.startsWith('approve_') || callbackData.startsWith('deny_'))) {
                    this.logger.log(`[APPROVAL_TRACE] Founder ${fromId} clicked approval button: ${callbackData}`);
                    // 1. Verify founder status
                    const user = await this.prisma.user.findUnique({
                        where: { telegramId: fromId },
                        select: { isFoundingMember: true },
                    });

                    if (!user?.isFoundingMember) {
                        this.logger.warn(`Non-founder ${fromId} tried to approve/deny onboarding.`);
                        return { ok: true };
                    }

                    // 2. Parse data: "approve_sessionId|displayName"
                    const [actionWithId, displayName] = callbackData.split('|');
                    
                    if (actionWithId.startsWith('approve_')) {
                        const sessionId = actionWithId.replace('approve_', '');
                        await this.profileBuilder.finalize(sessionId);
                        await this.replySender.sendReply(
                            String(update.callback_query.message?.chat.id),
                            `✅ *Approved:* ${displayName} is now part of the squad.`
                        );
                    } else if (actionWithId.startsWith('deny_')) {
                        const sessionId = actionWithId.replace('deny_', '');
                        await this.profileBuilder.reject(sessionId);
                        await this.replySender.sendReply(
                            String(update.callback_query.message?.chat.id),
                            `❌ *Denied:* ${displayName} request rejected.`
                        );
                    }
                    
                    return { ok: true };
                }
            }
            // Check for HITL commands before parsing
            const messageText = update.message?.text;
            if (messageText) {
                const lower = messageText.toLowerCase();
                if (lower.startsWith('/confirm_')) {
                    const jobId = messageText.slice('/confirm_'.length).trim();
                    const confirmedBy = String(update.message?.from?.id ?? 'unknown');
                    await this.queueService.addHitlResumeJob(jobId, confirmedBy);
                    return { ok: true };
                }
                if (lower.startsWith('/cancel_')) {
                    // Phase 5: handle HITL cancellation
                    this.logger.log(
                        `HITL cancel received: ${messageText}`,
                    );
                    return { ok: true };
                }
                if (lower === '/claim-admin') {
                    const from = update.message?.from;
                    if (from) {
                        const result = await this.claimAdmin.execute(
                            String(from.id),
                            from.first_name,
                            from.username
                        );
                        await this.replySender.sendReply(String(update.message?.chat.id), result);
                    }
                    return { ok: true };
                }
                if (lower === '/clear') {
                    const chatId = String(update.message?.chat.id);
                    await this.redisService.client.del(`hot:${chatId}`);
                    await this.replySender.sendReply(chatId, '🗑️ *Elena\'s hot memory cleared.* Context reset to Day 1.');
                    return { ok: true };
                }
            }

            // Retrieve eagerly-resolved bot ID
            if (this.botId === null) {
                this.botId = this.replySender.getBotId();
            }

            // Step 2: Parse the update
            const parsed = parseMessage(update, this.botId);
            if (!parsed) {
                // Not a processable message (e.g., channel post, bot message)
                return { ok: true };
            }

            // Step 3: Stage 1 heuristic gate (zero cost)
            if (!shouldProcess(parsed)) {
                return { ok: true };
            }

            // Step 4: Rate limiting (Phase 2+)
            // TODO-PHASE2: RateLimiterService check here

            // Step 5: Send thinking reaction
            if (parsed.rawUpdate.message) {
                await this.reactionSender.sendThinkingReaction(
                    parsed.chatId,
                    parsed.rawUpdate.message.message_id,
                );
            }

            // Step 6: Push to BullMQ queue
            await this.queueService.addMessageJob(parsed);

            return { ok: true };
        } catch (error: unknown) {
            // Release the update_id lock so Telegram's retry can get through
            await this.redisService.client.del(`update:${String(updateId)}`);

            const message =
                error instanceof Error ? error.message : 'Unknown webhook error';
            this.logger.error(`Webhook pipeline error: ${message}`);

            // Return 200 to prevent Telegram from spamming retries
            return { ok: true };
        }
    }
}
