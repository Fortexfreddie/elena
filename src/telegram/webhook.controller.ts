import {
    Controller,
    Post,
    Body,
    UseGuards,
    Logger,
    HttpCode,
} from '@nestjs/common';
import { TelegramSecretGuard } from './guards/telegram-secret.guard.js';
import { parseMessage } from './message.parser.js';
import { shouldProcess } from './heuristic-gate.js';
import { ReactionSenderService } from './reaction.sender.js';
import { ReplySenderService } from './reply.sender.js';
import { QueueService } from '../queue/queue.service.js';
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
