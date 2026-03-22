import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Part } from '@google/genai';
import type { MessageJob } from './job.types';
import { QUEUE_NAMES } from './job.types';
import { FilterAgent } from '../agents/filter.agent';
import { ManagerAgent } from '../agents/manager.agent';
import {
  GEMINI_MODELS,
  INLINE_MEDIA_THRESHOLD,
} from '@app/common/gemini/gemini.constants';
import { GeminiService } from '@app/common/gemini/gemini.service';
import type {
  AgentContext,
  AssembledContext,
} from '@app/common/types/agent.types';
import { ReplySenderService } from '../telegram/reply.sender';
import {
  AssemblerService,
  HotMemoryService,
  WarmMemoryService,
} from '../memory/index';
import { OnboardingDetector } from '../onboarding/detector.service';
import { PrismaService } from '@app/database';
import { InterviewerService } from '../onboarding/interviewer.service';
import { TelegramMediaService } from '../telegram/media.service';
import { PersonasInjector } from '../agents/personas.injector';
import { buildStatusText } from '../agents/status.builder';
import { SecurityAlertService } from '../telegram/security-alert.service';
import { SanitizerService } from '../safety/sanitizer.service';
import { SafetyChecklistService } from '../safety/safety-checklist.service';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { LangfuseService } from '../audit/langfuse.service';
import { UpstashRedisService } from '@app/common';
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
    private readonly prisma: PrismaService,
    private readonly securityAlert: SecurityAlertService,
    private readonly sanitizer: SanitizerService,
    private readonly safetyChecklist: SafetyChecklistService,
    private readonly auditLogger: AuditLoggerService,
    private readonly langfuse: LangfuseService,
    private readonly redisService: UpstashRedisService,
  ) {
    super();
  }

  async process(job: Job<MessageJob>): Promise<void> {
    const { parsedMessage } = job.data;
    
    // Halt check — admin can pause all processing
    const isHalted = await this.redisService.client.get('elena:halt');
    if (isHalted) {
      this.logger.warn(`[HALT] Elena is halted — dropping job ${job.id}`);
      return;
    }

    const startTime = Date.now();

    const effectiveText = parsedMessage.replyToContext
      ? `[Replying to ${parsedMessage.replyToContext.displayName}: ${parsedMessage.replyToContext.text ?? '[media]'}]\n\n${parsedMessage.text ?? ''}`
      : (parsedMessage.text ?? null);

    this.logger.log(
      `Processing job ${job.id ?? 'unknown'} for chat ${parsedMessage.chatId}`,
    );

    await this.replySender.sendTypingAction(parsedMessage.chatId);

    const recognitionState = await this.onboardingDetector.check(
      parsedMessage.userId,
    );
    if (recognitionState !== 'known') {
      if ((recognitionState === 'unknown' || recognitionState === 'pending') && parsedMessage.isDm) {
        // Guest Activity Alert for Superadmin (Users seen in group or in onboarding)
        const from = parsedMessage.rawUpdate.message?.from;
        await this.securityAlert.sendGuestActivityAlert(
          parsedMessage.userId,
          from?.first_name || 'Anonymous',
          from?.username || null,
          parsedMessage.text || null,
          recognitionState as any,
        );
      }

      this.logger.log(
        `[ONBOARDING_TRACE] User ${parsedMessage.userId} recognition state: ${recognitionState}. Handling via interviewer.`,
      );
      const onboardingReply =
        await this.interviewer.handleMessage(parsedMessage);
      await this.replySender.sendReply(
        parsedMessage.chatId,
        onboardingReply,
        parsedMessage.rawUpdate.message?.message_id,
      );
      this.logger.log(
        `[ONBOARDING_TRACE] Interviewer reply sent for user ${parsedMessage.userId}. Pipeline exit.`,
      );
      return;
    }

    let mediaContent: Part | undefined = undefined;
    let uploadedFileName: string | undefined = undefined;
    if (parsedMessage.hasMedia && parsedMessage.mediaFileId) {
      try {
        if (
          parsedMessage.mediaFileSize &&
          parsedMessage.mediaFileSize > INLINE_MEDIA_THRESHOLD
        ) {
          // Use File API for large files (>10MB)
          const tempPath = await this.mediaService.downloadToTempFile(
            parsedMessage.mediaFileId,
          );
          if (tempPath) {
            const mimeType =
              parsedMessage.mediaType ?? 'application/octet-stream';
            const uploadedFile = await this.geminiService.uploadFile(
              tempPath,
              mimeType,
            );
            uploadedFileName = uploadedFile.name; // Keep for cleanup
            mediaContent = {
              fileData: {
                mimeType,
                fileUri: uploadedFile.fileUri,
              },
            };

            // Cleanup local temp file
            const fs = await import('fs/promises');
            await fs
              .unlink(tempPath)
              .catch((err) =>
                this.logger.warn(
                  `Failed to cleanup temp file ${tempPath}`,
                  err,
                ),
              );
          }
        } else {
          // Use inlineData for small files
          const media = await this.mediaService.downloadFileBase64(
            parsedMessage.mediaFileId,
            parsedMessage.mediaType,
          );
          if (media && !media.data.startsWith('ERROR:')) {
            mediaContent = {
              inlineData: { mimeType: media.mimeType, data: media.data },
            };
          } else if (media && media.data.startsWith('ERROR:')) {
            this.logger.warn(
              `Media download error for job ${job.id}: ${media.data}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(`Media download failed`, err);
      }
    }

    let mediaContextText: string | undefined = undefined;
    if (mediaContent) {
      try {
        this.logger.log(`Extracting textual context from media for job ${job.id}`);
        const isAudio =
          (mediaContent.inlineData?.mimeType?.startsWith('audio/') ||
            mediaContent.fileData?.mimeType?.startsWith('audio/')) ??
          false;
        const isVideo =
          (mediaContent.inlineData?.mimeType?.startsWith('video/') ||
            mediaContent.fileData?.mimeType?.startsWith('video/')) ??
          false;
        const isSticker = parsedMessage.isSticker;

        let prompt = 'Describe this image in 2-3 sentences. Be literal and technical.';
        let systemInstruction =
          'You are a media context extractor. Be concise and literal. Focus on the content visible or audible in the provided media.';

        if (isAudio) {
          prompt = 'Transcribe or summarize this audio. Be literal and capture the speaker\'s intent.';
        } else if (isSticker) {
          prompt = 'Identify or describe this sticker/emoji. What feeling or character does it show?';
        } else if (isVideo) {
          prompt = 'Describe this video in 2-3 sentences. Be literal and focus on actions/movement.';
        }

        const mediaContextResponse = await this.geminiService.generateContent(
          GEMINI_MODELS.FLASH,
          [
            {
              role: 'user',
              parts: [{ text: prompt }, mediaContent],
            },
          ],
          {
            systemInstruction:
              'You are a media context extractor. Be concise and literal. Focus on the content visible or audible in the provided media.',
          },
        );
        mediaContextText = mediaContextResponse.text?.trim();
        this.logger.debug(`Extracted media context: ${mediaContextText}`);
      } catch (err) {
        this.logger.warn(`Failed to extract media context`, err);
      }
    }

    let assembledContext: AssembledContext | undefined;
    try {
      let memoryStoreText = effectiveText ?? '';
      if (mediaContextText) {
        memoryStoreText = memoryStoreText
          ? `${memoryStoreText}\n\n[Media context: ${mediaContextText}]`
          : `[Media context: ${mediaContextText}]`;
      } else if (!effectiveText) {
        memoryStoreText = '[media]';
      }

      await this.hotMemory.addMessage(parsedMessage.chatId, {
        text: memoryStoreText,
        telegramDate: parsedMessage.telegramDate,
        updateId: parsedMessage.rawUpdate.update_id,
        userId: parsedMessage.userId,
        role: 'user',
      });

      assembledContext = await this.assembler.assemble(
        parsedMessage.chatId,
        parsedMessage.userId,
      );
      this.logger.log(
        `Context assembled. Hot messages count: ${assembledContext?.hotMessages?.length ?? 0}`,
      );
    } catch (error: unknown) {
      this.logger.error(`Memory assembly failed`, error);
      // Notify user that context is degraded
      await this.replySender
        .sendReply(
          parsedMessage.chatId,
          "I'm having a moment — my memory is hazy right now. " +
          "I'll do my best without full context.",
          parsedMessage.rawUpdate.message?.message_id,
        )
        .catch(() => { }); // non-fatal, ignore send failures
    }



    try {
      const context = { parsedMessage: { ...parsedMessage, text: effectiveText } } as any;
      const safetyResult = await this.safetyChecklist.run(context);
      if (!safetyResult.passed) {
        await this.replySender.sendReply(
          parsedMessage.chatId,
          safetyResult.deflectMessage ?? 
            "I can't help with that.",
          parsedMessage.rawUpdate.message?.message_id,
        ).catch(() => {})

        await this.auditLogger.log({
          actionType: 'safety_block',
          telegramId: parsedMessage.userId,
          jobId: String(job.id ?? ''),
          sanitizedSummary: safetyResult.reason ?? 'harmful content',
        })
        return;
      }

      const decision = await this.filterAgent.route(
        parsedMessage,
        assembledContext?.hotMessages ?? [],
        mediaContent,
        assembledContext?.userProfile,
      );


      if (decision.action === 'ignore') {
        if (parsedMessage.isDm) {
          this.logger.log(
            `[FILTER_TRACE] Filter suggested ignore in DM. Overriding to route to manager.`,
          );
          decision.action = 'route';
          decision.routeTo = 'manager';
        } else {
          this.logger.log(
            `[FILTER_TRACE] Filter action: ignore. Reason: ${decision.reason}. Pipeline exit.`,
          );
          return;
        }
      }

      if (decision.action === 'reply' && decision.reply) {
        if (decision.reply.trim().length === 0) {
          this.logger.warn(`Agent returned empty reply for job ${job.id}`);
          return;
        }

        const sanitizedReply = this.sanitizer.sanitize(
          decision.reply,
          new Set(), // filter replies don't have secrets context
        );

        await this.auditLogger.log({
          actionType: 'filter_reply',
          telegramId: parsedMessage.userId,
          jobId: job.id ?? 'unknown',
          agentName: 'filter',
          sanitizedSummary: sanitizedReply.slice(0, 500),
        });

        await this.hotMemory.addMessage(parsedMessage.chatId, {
          text: sanitizedReply,
          telegramDate: Math.floor(Date.now() / 1000),
          updateId: Date.now(),
          userId: 'Elena',
          role: 'assistant',
        });
        await this.replySender.sendReply(
          parsedMessage.chatId,
          sanitizedReply,
          parsedMessage.rawUpdate.message?.message_id,
        );
        this.logger.log(
          `[RESPONSE_TRACE] Elena (Filter) sending: ${sanitizedReply.slice(0, 150)}${sanitizedReply.length > 150 ? '...' : ''}`,
        );

        try {
          await this.warmMemory.store(
            `${effectiveText ?? '[media]'} | ${sanitizedReply}`,
            {
              userId: parsedMessage.userId,
              chatId: parsedMessage.chatId,
              accessLevel: 'private',
              timestamp: Date.now(),
            },
          );
          this.logger.debug(
            `Stored warm memory for chat ${parsedMessage.chatId}`,
          );
        } catch (e: unknown) {
          this.logger.warn(
            `Warm memory store failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        return;
      }

      if (decision.action === 'route' && decision.routeTo) {
        const context = assembledContext ?? {
          hotMessages: [],
          warmResults: [],
          userProfile: null,
          activeBounties: [],
        };

        const agentContext: AgentContext = {
          parsedMessage: {
            ...parsedMessage,
            text: mediaContextText
              ? (effectiveText ? `${effectiveText}\n\n[Media context: ${mediaContextText}]` : `[Media context: ${mediaContextText}]`)
              : effectiveText,
          },
          assembledContext: context,
          systemBlock: '',
          decryptedSecretsSet: new Set(),
          mediaContent,
        };

        // NEW: Status Message System Wiring
        let statusMessageId: number | undefined = undefined;
        try {
          const initialStatusText = buildInitialStatus(decision.routeTo);
          const sentId = await this.replySender.sendStatusMessage(
            parsedMessage.chatId,
            initialStatusText,
          );
          if (sentId) {
            statusMessageId = sentId;
            agentContext.statusMessageId = statusMessageId;
            agentContext.statusStartTime = Date.now();
            agentContext.onStatusUpdate = async (update) => {
              if (statusMessageId) {
                const text = buildStatusText(update);
                await this.replySender.updateStatusMessage(
                  parsedMessage.chatId,
                  statusMessageId,
                  text,
                );
              }
            };
          }
        } catch (statusErr) {
          this.logger.warn(`Failed to initialize status message: ${statusErr}`);
        }

        try {
          this.logger.log(
            `[EXECUTION_TRACE] Manager routing execution to agent: ${decision.routeTo}`,
          );
          const response = await this.managerAgent.execute(
            decision.routeTo,
            agentContext,
          );
          this.logger.log(
            `[EXECUTION_TRACE] Agent '${decision.routeTo}' completed in ${Date.now() - startTime}ms`,
          );

          if (response.functionCalls && response.functionCalls.length > 0 && (!response.text || response.text.trim().length === 0)) {
            this.logger.warn(
              `Non-text parts (functionCalls) detected with no text in final agent response for chat ${parsedMessage.chatId}.`,
            );
          } else if (response.functionCalls && response.functionCalls.length > 0) {
            this.logger.debug(
              `Agent had pending tool calls in final response but text was present — text used, tool calls ignored.`,
            );
          }

          if (!response.text || response.text.trim().length === 0) {
            this.logger.warn(`Agent returned empty response for job ${job.id}`);
            return;
          }

          // Before replySender.sendReply() for agent responses:
          const sanitizedResponse = this.sanitizer.sanitize(
            response.text,
            agentContext.decryptedSecretsSet,
          );

          // Audit log every agent completion
          await this.auditLogger.log({
            actionType: 'agent_response',
            telegramId: parsedMessage.userId,
            jobId: job.id ?? 'unknown',
            agentName: response.agentName,
            modelUsed: response.modelUsed,
            toolCalled: response.toolsCalled?.join(', ') ?? null,
            sanitizedSummary: sanitizedResponse.slice(0, 500),
            latencyMs: response.latencyMs,
          });

          // Langfuse trace
          await this.langfuse.trace({
            jobId: job.id ?? `elena-${Date.now()}`,
            userId: parsedMessage.userId,
            chatId: parsedMessage.chatId,
            agentName: response.agentName,
            modelUsed: response.modelUsed,
            inputText: effectiveText ?? '[media]',
            outputText: sanitizedResponse,
            toolsCalled: response.toolsCalled ?? [],
            latencyMs: response.latencyMs,
          });

          await this.hotMemory.addMessage(parsedMessage.chatId, {
            text: sanitizedResponse,
            telegramDate: Math.floor(Date.now() / 1000),
            updateId: Date.now(),
            userId: 'Elena',
            role: 'assistant',
          });

          // Replace status message or send new reply
          if (statusMessageId) {
            await this.replySender.deleteMessage(
              parsedMessage.chatId,
              statusMessageId,
            );
          }
          await this.replySender.sendReply(
            parsedMessage.chatId,
            sanitizedResponse,
            parsedMessage.rawUpdate.message?.message_id,
          );
          this.logger.log(
            `[RESPONSE_TRACE] Elena (${decision.routeTo}) sending: ${sanitizedResponse.slice(0, 150)}${sanitizedResponse.length > 150 ? '...' : ''}`,
          );

          const textToStore = sanitizedResponse?.trim();
          if (textToStore && textToStore.length > 0) {
            try {
              await this.warmMemory.store(
                `${effectiveText ?? '[media]'} | ${textToStore}`,
                {
                  userId: parsedMessage.userId,
                  chatId: parsedMessage.chatId,
                  accessLevel: 'private',
                  timestamp: Date.now(),
                },
              );
              this.logger.debug(
                `Stored warm memory for chat ${parsedMessage.chatId}`,
              );
            } catch (warnErr: unknown) {
              this.logger.warn(
                `Failed to store warm memory (non-fatal): ${warnErr instanceof Error ? warnErr.message : String(warnErr)}`,
              );
            }
          }
        } catch (execErr: unknown) {
          this.logger.error(`Execution routing failed:`, execErr);
          
          // M-4: Delete stranded status message if execution throws an error
          if (statusMessageId) {
            await this.replySender.deleteMessage(parsedMessage.chatId, statusMessageId)
              .catch((err) => this.logger.warn(`Failed to cleanup status message on crash: ${err}`));
          }
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Processor stage failed`, error);

      await this.auditLogger.log({
        actionType: 'job_failed',
        telegramId: parsedMessage.userId,
        jobId: String(job.id ?? ''),
        sanitizedSummary: error instanceof Error 
          ? error.message.slice(0, 200) 
          : 'Unknown error',
      }).catch(() => {}) // double safety — catch log failure too

      throw error;
    } finally {
      if (uploadedFileName) {
        try {
          await this.geminiService.deleteFile(uploadedFileName);
          this.logger.debug(
            `Cleaned up Gemini File API file: ${uploadedFileName}`,
          );
        } catch (cleanErr) {
          this.logger.warn(
            `Failed to cleanup Gemini File API file: ${cleanErr}`,
          );
        }
      }
    }

    this.logger.log(
      `Job ${job.id ?? 'unknown'} completed in ${Date.now() - startTime}ms`,
    );
  }
}

/**
 * Builds the initial "Starting up..." status text.
 */
function buildInitialStatus(routeTo: string): string {
  const agentEmoji: Record<string, string> = {
    coder: '👨💻',
    researcher: '🔍',
    reviewer: '🔎',
    brainstorm: '🧠',
    task: '📋',
    manager: '🤔',
  };
  const emoji = agentEmoji[routeTo.toLowerCase()] ?? '⚡';
  const name = routeTo.charAt(0).toUpperCase() + routeTo.slice(1);
  return `${emoji} ${name} Agent\n━━━━━━━━━━━━━━━━━━━\n⏳ Starting up...`;
}
