import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { MessageJob } from './job.types.js';
import { QUEUE_NAMES } from './job.types.js';
import { FilterAgent } from '../agents/filter.agent.js';
import { ReplySenderService } from '../telegram/reply.sender.js';

/**
 * BullMQ processor for the elena-messages queue.
 *
 * Phase 1: Logs the job and calls the FilterAgent to prove the AI pipeline works.
 * Configured with concurrency=10, group by chatId (sequential per chat).
 */
@Processor(QUEUE_NAMES.MESSAGES, {
    concurrency: 10,
    lockDuration: 30000,
    maxStalledCount: 2,
})
export class MessageProcessor extends WorkerHost {
    private readonly logger = new Logger(MessageProcessor.name);

    constructor(
        private readonly filterAgent: FilterAgent,
        private readonly replySender: ReplySenderService,
    ) {
        super();
    }

    async process(job: Job<MessageJob>): Promise<void> {
        const { parsedMessage } = job.data;
        const startTime = Date.now();

        this.logger.log(
            `Processing job ${job.id ?? 'unknown'} | ` +
            `chat: ${parsedMessage.chatId} | ` +
            `user: ${parsedMessage.userId} | ` +
            `hasMedia: ${String(parsedMessage.hasMedia)} | ` +
            `text: ${parsedMessage.text?.slice(0, 100) ?? '[no text]'}`,
        );

        // UI: Show typing... while AI thinks
        await this.replySender.sendTypingAction(parsedMessage.chatId);

        // Stage 2: AI Filter Agent routing
        try {
            const decision = await this.filterAgent.route(parsedMessage);
            this.logger.log(`Filter decision: ${decision.action} (${decision.reason})`);

            if (decision.action === 'reply' && decision.reply) {
                await this.replySender.sendReply(
                    parsedMessage.chatId,
                    decision.reply,
                    parsedMessage.rawUpdate.message?.message_id,
                );
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown processor error';
            this.logger.error(`Processor stage failed: ${message}`);
            throw error; // Let BullMQ mark as failed and trigger retry logic
        }

        const elapsed = Date.now() - startTime;
        this.logger.log(
            `Job ${job.id ?? 'unknown'} completed in ${String(elapsed)}ms`,
        );
    }
}
