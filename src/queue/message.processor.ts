import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { MessageJob } from './job.types.js';
import { QUEUE_NAMES } from './job.types.js';
import { FilterAgent } from '../agents/filter.agent.js';
import { ManagerAgent } from '../agents/manager.agent.js';
import type { AgentContext } from '@app/common/types/agent.types';
import { ReplySenderService } from '../telegram/reply.sender.js';
import { AssemblerService, HotMemoryService } from '../memory/index.js';

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
        private readonly managerAgent: ManagerAgent,
        private readonly replySender: ReplySenderService,
        private readonly assembler: AssemblerService,
        private readonly hotMemory: HotMemoryService,
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

        // Stage 1.5: Memory Assembly
        let assembledContext: any;
        try {
            // First save the incoming message to hot memory
            await this.hotMemory.addMessage(parsedMessage.chatId, {
                text: parsedMessage.text ?? '[media]',
                telegramDate: parsedMessage.telegramDate,
                updateId: parsedMessage.rawUpdate.update_id,
                userId: parsedMessage.userId,
                role: 'user',
            });

            // Gather context from hot, warm, cold
            assembledContext = await this.assembler.assemble(
                parsedMessage.chatId,
                parsedMessage.userId,
            );
            this.logger.log(`Context assembled. Hot messages count: ${assembledContext?.hotMessages?.length ?? 0}`);
        } catch (error: unknown) {
            this.logger.error(`Memory assembly failed, proceeding with empty context`, error);
        }

        // Stage 2: AI Filter Agent routing
        try {
            const decision = await this.filterAgent.route(
                parsedMessage,
                assembledContext?.hotMessages ?? [],
            );
            this.logger.log(`Filter decision: ${decision.action} (${decision.reason})`);

            if (decision.action === 'reply' && !decision.reply) {
                this.logger.warn('Filter decided to reply but provided no text. Falling back to manager agent.');
                decision.action = 'route';
                decision.routeTo = 'manager';
            }

            if (decision.action === 'reply' && decision.reply) {
                this.logger.log(`[RESPONSE_TRACE] Elena (Filter) sending: ${decision.reply.slice(0, 150)}...`);
                
                // If direct reply, save to hot memory
                await this.hotMemory.addMessage(parsedMessage.chatId, {
                    text: decision.reply,
                    telegramDate: Math.floor(Date.now() / 1000), // Current unix seconds
                    updateId: 0, // Assistant messages don't have update_ids natively
                    userId: 'Elena',
                    role: 'assistant',
                });

                await this.replySender.sendReply(
                    parsedMessage.chatId,
                    decision.reply,
                    parsedMessage.rawUpdate.message?.message_id,
                );
            } else if (decision.action === 'route' && decision.routeTo) {
                // Execute sub-agent via manager
                const agentContext: AgentContext = {
                    parsedMessage,
                    assembledContext,
                    // Injecting core Elena persona and User context
                    systemBlock: `You are Elena. You are female, warm, direct, sharp, and kind. No corporate robot energy. Use these traits in every response.
User Name: ${assembledContext.userProfile?.displayName ?? 'Unknown'}`,
                    decryptedSecretsSet: new Set()
                };

                const response = await this.managerAgent.execute(decision.routeTo, agentContext);
                this.logger.log(`Sub-agent [${response.agentName}] completed in ${response.latencyMs}ms`);
                this.logger.log(`[RESPONSE_TRACE] Elena (${response.agentName}) sending: ${response.text.slice(0, 150)}...`);

                // Save assistant reply to hot memory
                await this.hotMemory.addMessage(parsedMessage.chatId, {
                    text: response.text,
                    telegramDate: Math.floor(Date.now() / 1000),
                    updateId: 0,
                    userId: 'Elena',
                    role: 'assistant',
                });

                await this.replySender.sendReply(
                    parsedMessage.chatId,
                    response.text,
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
