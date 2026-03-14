import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Part } from '@google/genai';
import type { MessageJob } from './job.types';
import { QUEUE_NAMES } from './job.types';
import { FilterAgent } from '../agents/filter.agent';
import { ManagerAgent } from '../agents/manager.agent';
import { GEMINI_MODELS, INLINE_MEDIA_THRESHOLD } from '@app/common/gemini/gemini.constants';
import { GeminiService } from '@app/common/gemini/gemini.service';
import type { AgentContext, AssembledContext } from '@app/common/types/agent.types';
import { ReplySenderService } from '../telegram/reply.sender';
import { AssemblerService, HotMemoryService, WarmMemoryService } from '../memory/index';
import { OnboardingDetector } from '../onboarding/detector.service';
import { InterviewerService } from '../onboarding/interviewer.service';
import { TelegramMediaService } from '../telegram/media.service';
import { PersonasInjector } from '../agents/personas.injector';

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
        private readonly warmMemory: WarmMemoryService,
        @Inject(forwardRef(() => OnboardingDetector))
        private readonly onboardingDetector: OnboardingDetector,
        @Inject(forwardRef(() => InterviewerService))
        private readonly interviewer: InterviewerService,
        private readonly mediaService: TelegramMediaService,
        private readonly personasInjector: PersonasInjector,
        private readonly geminiService: GeminiService,
    ) {
        super();
    }

    async process(job: Job<MessageJob>): Promise<void> {
        const { parsedMessage } = job.data;
        const startTime = Date.now();

        const effectiveText = parsedMessage.replyToContext
            ? `[Replying to ${parsedMessage.replyToContext.displayName}: ${parsedMessage.replyToContext.text ?? '[media]'}]\n\n${parsedMessage.text ?? ''}`
            : (parsedMessage.text ?? null);

        this.logger.log(`Processing job ${job.id ?? 'unknown'} for chat ${parsedMessage.chatId}`);

        await this.replySender.sendTypingAction(parsedMessage.chatId);

        const recognitionState = await this.onboardingDetector.check(parsedMessage.userId);
        if (recognitionState !== 'known') {
            this.logger.log(`[ONBOARDING_TRACE] User ${parsedMessage.userId} recognition state: ${recognitionState}. Handling via interviewer.`);
            const onboardingReply = await this.interviewer.handleMessage(parsedMessage);
            await this.replySender.sendReply(parsedMessage.chatId, onboardingReply, parsedMessage.rawUpdate.message?.message_id);
            this.logger.log(`[ONBOARDING_TRACE] Interviewer reply sent for user ${parsedMessage.userId}. Pipeline exit.`);
            return;
        }

        let assembledContext: AssembledContext | undefined;
        try {
            await this.hotMemory.addMessage(parsedMessage.chatId, {
                text: effectiveText ?? '[media]',
                telegramDate: parsedMessage.telegramDate,
                updateId: parsedMessage.rawUpdate.update_id,
                userId: parsedMessage.userId,
                role: 'user',
            });

            assembledContext = await this.assembler.assemble(parsedMessage.chatId, parsedMessage.userId);
            this.logger.log(`Context assembled. Hot messages count: ${assembledContext?.hotMessages?.length ?? 0}`);
        } catch (error: unknown) {
            this.logger.error(`Memory assembly failed`, error);
            // Notify user that context is degraded
            await this.replySender.sendReply(
                parsedMessage.chatId,
                "I'm having a moment — my memory is hazy right now. " +
                "I'll do my best without full context.",
                parsedMessage.rawUpdate.message?.message_id
            ).catch(() => {});  // non-fatal, ignore send failures
        }

        let mediaContent: Part | undefined = undefined;
        let uploadedFileName: string | undefined = undefined;
        if (parsedMessage.hasMedia && parsedMessage.mediaFileId) {
            try {
                if (parsedMessage.mediaFileSize && parsedMessage.mediaFileSize > INLINE_MEDIA_THRESHOLD) {
                    // Use File API for large files (>10MB)
                    const tempPath = await this.mediaService.downloadToTempFile(parsedMessage.mediaFileId);
                    if (tempPath) {
                        const mimeType = parsedMessage.mediaType ?? 'application/octet-stream';
                        const uploadedFile = await this.geminiService.uploadFile(tempPath, mimeType);
                        uploadedFileName = uploadedFile.name; // Keep for cleanup
                        mediaContent = {
                            fileData: {
                                mimeType,
                                fileUri: uploadedFile.fileUri
                            }
                        };
                        
                        // Cleanup local temp file
                        const fs = await import('fs/promises');
                        await fs.unlink(tempPath).catch(err => 
                            this.logger.warn(`Failed to cleanup temp file ${tempPath}`, err)
                        );
                    }
                } else {
                    // Use inlineData for small files
                    const media = await this.mediaService.downloadFileBase64(parsedMessage.mediaFileId, parsedMessage.mediaType);
                    if (media && !media.data.startsWith('ERROR:')) {
                        mediaContent = { inlineData: { mimeType: media.mimeType, data: media.data } };
                    } else if (media && media.data.startsWith('ERROR:')) {
                        this.logger.warn(`Media download error for job ${job.id}: ${media.data}`);
                    }
                }
            } catch (err) {
                this.logger.error(`Media download failed`, err);
            }
        }

        try {
            const decision = await this.filterAgent.route(parsedMessage, assembledContext?.hotMessages ?? [], mediaContent);

            if (decision.action === 'ignore') {
                if (parsedMessage.isDm) {
                    this.logger.log(`[FILTER_TRACE] Filter suggested ignore in DM. Overriding to route to manager.`);
                    decision.action = 'route';
                    decision.routeTo = 'manager';
                } else {
                    this.logger.log(`[FILTER_TRACE] Filter action: ignore. Reason: ${decision.reason}. Pipeline exit.`);
                    return;
                }
            }

            if (decision.action === 'reply' && decision.reply) {
                if (decision.reply.trim().length === 0) {
                    this.logger.warn(`Agent returned empty reply for job ${job.id}`);
                    return;
                }

                await this.hotMemory.addMessage(parsedMessage.chatId, {
                    text: decision.reply,
                    telegramDate: Math.floor(Date.now() / 1000),
                    updateId: Date.now(),
                    userId: 'Elena',
                    role: 'assistant',
                });
                await this.replySender.sendReply(parsedMessage.chatId, decision.reply, parsedMessage.rawUpdate.message?.message_id);
                this.logger.log(`[RESPONSE_TRACE] Elena (Filter) sending: ${decision.reply.slice(0, 150)}${decision.reply.length > 150 ? '...' : ''}`);

                try {
                    await this.warmMemory.store(
                        `${effectiveText ?? '[media]'} | ${decision.reply}`,
                        {
                            userId: parsedMessage.userId,
                            chatId: parsedMessage.chatId,
                            accessLevel: 'private',
                            timestamp: Date.now(),
                        }
                    );
                    this.logger.debug(`Stored warm memory for chat ${parsedMessage.chatId}`);
                } catch (e: unknown) {
                    this.logger.warn(`Warm memory store failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
                }
                return;
            }

            if (decision.action === 'route' && decision.routeTo) {
                const context = assembledContext ?? {
                    hotMessages: [],
                    warmResults: [],
                    userProfile: null,
                    activeBounties: []
                };

                const agentContext: AgentContext = {
                    parsedMessage: {
                        ...parsedMessage,
                        text: effectiveText
                    },
                    assembledContext: context,
                    systemBlock: '',
                    decryptedSecretsSet: new Set(),
                    mediaContent
                };

                try {
                    this.logger.log(`[EXECUTION_TRACE] Manager routing execution to agent: ${decision.routeTo}`);
                    const response = await this.managerAgent.execute(decision.routeTo!, agentContext);
                    this.logger.log(`[EXECUTION_TRACE] Agent '${decision.routeTo}' completed in ${Date.now() - startTime}ms`);

                    if (response.functionCalls && response.functionCalls.length > 0) {
                        this.logger.warn(`Non-text parts (functionCalls) detected in final agent response for chat ${parsedMessage.chatId}. Storing text segment only.`);
                    }

                    if (!response.text || response.text.trim().length === 0) {
                        this.logger.warn(`Agent returned empty response for job ${job.id}`);
                        return;
                    }

                    await this.hotMemory.addMessage(parsedMessage.chatId, {
                        text: response.text,
                        telegramDate: Math.floor(Date.now() / 1000),
                        updateId: Date.now(),
                        userId: 'Elena',
                        role: 'assistant',
                    });

                    await this.replySender.sendReply(parsedMessage.chatId, response.text, parsedMessage.rawUpdate.message?.message_id);

                    const textToStore = response.text?.trim();
                    if (textToStore && textToStore.length > 0) {
                        try {
                            await this.warmMemory.store(
                                `${parsedMessage.text ?? '[media]'} | ${textToStore}`,
                                {
                                    userId: parsedMessage.userId,
                                    chatId: parsedMessage.chatId,
                                    accessLevel: 'private',
                                    timestamp: Date.now(),
                                }
                            );
                            this.logger.debug(`Stored warm memory for chat ${parsedMessage.chatId}`);
                        } catch (warnErr: unknown) {
                            this.logger.warn(`Failed to store warm memory (non-fatal): ${warnErr instanceof Error ? warnErr.message : String(warnErr)}`);
                        }
                    }
                } finally {
                    if (uploadedFileName) {
                        try {
                            await this.geminiService.deleteFile(uploadedFileName);
                            this.logger.debug(`Cleaned up Gemini File API file: ${uploadedFileName}`);
                        } catch (cleanErr) {
                            this.logger.warn(`Failed to cleanup Gemini File API file: ${cleanErr}`);
                        }
                    }
                }
            }
        } catch (error: unknown) {
            this.logger.error(`Processor stage failed`, error);
            throw error;
        }

        this.logger.log(`Job ${job.id ?? 'unknown'} completed in ${Date.now() - startTime}ms`);
    }
}
