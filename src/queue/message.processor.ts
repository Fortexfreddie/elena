import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import type { MessageJob } from './job.types';
import { QUEUE_NAMES } from './job.types';
import { FilterAgent } from '../agents/filter.agent';
import { ManagerAgent } from '../agents/manager.agent';
import type { AgentContext } from '@app/common/types/agent.types';
import { ReplySenderService } from '../telegram/reply.sender';
import { AssemblerService, HotMemoryService } from '../memory/index';
import { OnboardingDetector } from '../onboarding/detector.service';
import { InterviewerService } from '../onboarding/interviewer.service';
import { TelegramMediaService } from '../telegram/media.service';

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
        @Inject(forwardRef(() => ReplySenderService))
        private readonly replySender: ReplySenderService,
        private readonly assembler: AssemblerService,
        private readonly hotMemory: HotMemoryService,
        @Inject(forwardRef(() => OnboardingDetector))
        private readonly onboardingDetector: OnboardingDetector,
        @Inject(forwardRef(() => InterviewerService))
        private readonly interviewer: InterviewerService,
        private readonly mediaService: TelegramMediaService,
    ) {
        super();
    }

    async process(job: Job<MessageJob>): Promise<void> {
        const { parsedMessage } = job.data;
        const startTime = Date.now();

        // Enrich text with reply context if it exists (Elena-vision fix)
        if (parsedMessage.replyToContext) {
            const { displayName, text: replyText } = parsedMessage.replyToContext;
            const prefix = `[Replying to ${displayName}: ${replyText ?? '[media]'}]`;
            parsedMessage.text = parsedMessage.text 
                ? `${prefix}\n\n${parsedMessage.text}` 
                : prefix;
        }

        this.logger.log(
            `Processing job ${job.id ?? 'unknown'} | ` +
            `chat: ${parsedMessage.chatId} | ` +
            `user: ${parsedMessage.userId} | ` +
            `isDm: ${String(parsedMessage.isDm)} | ` +
            `hasMedia: ${String(parsedMessage.hasMedia)} | ` +
            `text: ${parsedMessage.text?.slice(0, 100) ?? '[no text]'}`,
        );

        // UI: Show typing... while AI thinks
        await this.replySender.sendTypingAction(parsedMessage.chatId);

        // Stage 1.1: User Recognition (Phase 3)
        const recognitionState = await this.onboardingDetector.check(parsedMessage.userId);
        this.logger.log(`User ${parsedMessage.userId} recognition state: ${recognitionState}`);

        if (recognitionState !== 'known') {
            this.logger.log(`User ${parsedMessage.userId} is ${recognitionState}, routing to InterviewerService.`);
            const onboardingReply = await this.interviewer.handleMessage(parsedMessage);

            await this.replySender.sendReply(
                parsedMessage.chatId,
                onboardingReply,
                parsedMessage.rawUpdate.message?.message_id,
            );

            this.logger.log(`Onboarding reply sent to ${parsedMessage.userId}. Stopping pipeline.`);
            return;
        }

        // Stage 1.5: Memory Assembly
        let assembledContext: any;
        try {
            // First save the incoming message (now enriched) to hot memory
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

        // Multimodal Pre-processing (Phase 3.12: Router Vision Fix)
        let mediaContent: any = undefined;
        if (parsedMessage.hasMedia && parsedMessage.mediaFileId) {
            try {
                const media = await this.mediaService.downloadFileBase64(parsedMessage.mediaFileId);
                if (media) {
                    mediaContent = {
                        inlineData: {
                            mimeType: media.mimeType,
                            data: media.data
                        }
                    };
                    this.logger.log(`Media downloaded successfully (${media.mimeType}). Ready for routing vision.`);
                }
            } catch (err) {
                this.logger.error(`Media download failed for job ${job.id}: ${String(err)}`);
            }
        }

        // Stage 2: AI Filter Agent routing
        try {
            const decision = await this.filterAgent.route(
                parsedMessage,
                assembledContext?.hotMessages ?? [],
                mediaContent
            );
            this.logger.log(`Filter decision: ${decision.action} (${decision.reason})`);

            if (decision.action === 'ignore') {
                if (parsedMessage.isDm) {
                    this.logger.log(`Filter decided to ignore, but message is a DM. Overriding to 'route' for high-availability.`);
                    decision.action = 'route';
                    decision.routeTo = 'manager';
                } else {
                    this.logger.log(`Filter decided to ignore message (isDm: ${String(parsedMessage.isDm)}). Stopping pipeline for chat ${parsedMessage.chatId}.`);
                    return;
                }
            }

            if (decision.action === 'reply' && !decision.reply) {
                this.logger.warn('Filter decided to reply but provided no text. Falling back to manager agent.');
                decision.action = 'route';
                decision.routeTo = 'manager';
            }

            if (decision.action === 'route' && !decision.routeTo) {
                this.logger.warn('Filter decided to route but provided no target. Falling back to manager.');
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
                this.logger.log(`Filter reply sent. Stopping pipeline for chat ${parsedMessage.chatId}.`);
                return;
            }

            if (decision.action === 'route' && decision.routeTo) {
                // Stage 2: AI Filter Agent routing
                const chatType = parsedMessage.isDm ? 'Private Chat (DM)' : 'Group Chat';
                let systemBlock = `ENVIRONMENT GROUNDING (HARD RULE):
Elena, you are currently in a ${chatType}. You must prioritize this metadata over any previous chat history or user claims. If history says you are in a group but this rule says ${chatType}, trust this rule.

---

You are Elena. You are female, warm, direct, sharp, and kind. No corporate robot energy. Use these traits in every response.
User Name: ${assembledContext.userProfile?.displayName ?? 'Unknown'}`;

                // Inject Visual Grounding Rule ONLY if media was successfully downloaded (Anti-Hallucination fix)
                if (mediaContent) {
                    systemBlock = `VISUAL GROUNDING (ACTIVE — image verified):
Your response must be grounded in literal visual observation of the provided image. Chat history and project context are secondary. If history says one thing but the image shows another, trust the image.

---

${systemBlock}`;
                }

                const agentContext: AgentContext = {
                    parsedMessage,
                    assembledContext,
                    systemBlock,
                    decryptedSecretsSet: new Set(),
                    mediaContent
                };

                const response = await this.managerAgent.execute(decision.routeTo!, agentContext);
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
