import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { OnboardingAgent } from '../agents/onboarding.agent';
import { ApproverService } from './approver.service';
import { ProfileBuilder } from '../personas/profile-builder.service';
import {
  OnboardingSessionStatus,
  UserRole,
  OnboardingStatus,
} from '@prisma/client';
import type {
  AgentContext,
  SaveInterviewArgs,
} from '@app/common/types/agent.types';
import { SaveInterviewArgsSchema } from '@app/common/types/agent.types';
import type { ParsedMessage } from '@app/common/types/telegram.types';

import { UpstashRedisService } from '@app/common';

@Injectable()
export class InterviewerService {
  private readonly logger = new Logger(InterviewerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OnboardingAgent))
    private readonly onboardingAgent: OnboardingAgent,
    private readonly approver: ApproverService,
    private readonly profileBuilder: ProfileBuilder,
    private readonly redis: UpstashRedisService,
  ) {}

  /**
   * Handles an onboarding message from a user.
   * Orchestrates session state and agent interaction.
   */
  async handleMessage(parsedMessage: ParsedMessage): Promise<string> {
    const { userId, text, chatId } = parsedMessage;
    const lockKey = `lock:onboarding:${userId}`;

    // 1. Acquire distributed lock (5-second safety window)
    const lockAcquired = await this.redis.client.set(lockKey, 'locked', {
      nx: true,
      ex: 120, // H-6: Extended - Gemini Pro can take 15-25s per call, agent may iterate
    });

    if (!lockAcquired) {
      this.logger.warn(
        `[ONBOARDING_TRACE] User ${userId}: Race condition detected. Dropping concurrent message.`,
      );
      return 'Processing your previous message... please wait a second.';
    }

    try {
      // 1. Get or create session
      let session = await this.prisma.onboardingSession.findFirst({
        where: {
          telegramId: userId,
          status: OnboardingSessionStatus.in_progress,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!session) {
        this.logger.log(
          `[ONBOARDING_TRACE] User ${userId}: No active session. Creating new one.`,
        );
        session = await this.prisma.onboardingSession.create({
          data: {
            telegramId: userId,
            status: OnboardingSessionStatus.in_progress,
            conversationJson: [],
          },
        });
      }

      // Phase 3 Fix: Ensure User record exists early so they show up in Prisma Studio
      // and we can track their progress even if they drop off mid-interview.
      const from = parsedMessage.rawUpdate.message?.from;
      const currentUser = await this.prisma.user.findUnique({
        where: { telegramId: userId },
      });

      if (currentUser?.onboardingStatus === 'approved') {
        this.logger.log(
          `[ONBOARDING_TRACE] User ${userId} is already approved. Skipping status re-init.`,
        );
      } else {
        await this.prisma.user.upsert({
          where: { telegramId: userId },
          update: {
            username: from?.username || null,
          },
          create: {
            telegramId: userId,
            displayName: from?.first_name || 'Newcomer',
            username: from?.username || null,
            onboardingStatus: 'pending',
          },
        });
      }

      // 2. Build context for the agent
      const history = session.conversationJson as any[];
      const agentContext: AgentContext = {
        parsedMessage,
        assembledContext: {
          hotMessages: history.map((h) => ({
            role: h.role,
            text: h.text,
            telegramDate: Math.floor(Date.now() / 1000),
            updateId: 0,
            userId: h.role === 'user' ? userId : 'Elena',
          })),
          userProfile: null, // New users don't have a profile yet
          warmResults: [],
          activeBounties: [],
        },
        systemBlock: `You are Elena, interviewing a newcomer for the squad. 
Be conversational, witty, and sharp. Avoid overly enthusiastic, 'cringey' slang, or excessive emojis. Keep it natural. Ask them for their preferred Name, Role (e.g., dev, designer), and Technical Tone. Once you have all three pieces of info, strictly call 'save_interview'.`,
        decryptedSecretsSet: new Set(),
      };

      // 3. Run the Onboarding Agent
      const response = await this.onboardingAgent.run(agentContext);

      // 4. Update session history
      const updatedHistory = [...history];
      if (text) {
        updatedHistory.push({ role: 'user', text });
      }
      updatedHistory.push({ role: 'assistant', text: response.text });

      // 5. Check if agent called save_interview at any point during the run.
      // BaseAgent.run() collects ALL function calls across iterations in response.functionCalls,
      // so this check reliably detects save_interview even if the model continued after calling it.
      const saveInterviewCall = response.functionCalls?.find(
        (fc) => fc.name === 'save_interview',
      );

      if (saveInterviewCall) {
        this.logger.log(
          `[ONBOARDING_TRACE] User ${userId}: Agent triggered 'save_interview'. Data: ${JSON.stringify(saveInterviewCall.args)}`,
        );

        // Validate data with Zod before proceeding
        const validation = SaveInterviewArgsSchema.safeParse(
          saveInterviewCall.args,
        );
        if (!validation.success) {
          this.logger.error(
            `[ONBOARDING_TRACE] User ${userId}: Invalid interview data from model: ${validation.error.message}`,
          );
          // Fallback: we could either return an error or try a graceful degradation.
          // Given the instructions, we'll return a simple response to the user.
          return "I'm having a little trouble processing your details. Could you try telling me your name and role again?";
        }

        const interviewData = validation.data;

        await this.prisma.onboardingSession.update({
          where: { id: session.id },
          data: {
            status: OnboardingSessionStatus.pending_approval,
            builtProfileJson: interviewData as any, // Database field is JSON
            conversationJson: updatedHistory,
          },
        });

        // Notify founders
        const founderCount = await this.approver.notifyFounders(
          session.id,
          interviewData.displayName,
          interviewData.role,
          interviewData.summary,
        );

        // Bootstrap Logic: If ZERO founders exist, auto-approve this first user
        let finalReply = response.text?.trim() ||
          `Got it, ${interviewData.displayName}! I've sent your request to the squad founders for approval. Stand by.`;

        if (founderCount === 0) {
          this.logger.log(
            `[ONBOARDING_TRACE] No founders found. Bootstrapping user ${userId} as Superadmin.`,
          );
          await this.profileBuilder.finalize(session.id);
          await this.prisma.user.update({
            where: { telegramId: userId },
            data: {
              role: UserRole.superadmin,
              isFoundingMember: true,
              onboardingStatus: OnboardingStatus.approved,
            },
          });

          // Override agent text to reflect the superadmin status immediately 
          finalReply = `Welcome home, boss! 🚀\n\nSince you're the first one here, I've initialized you as the *Superadmin and Founding Member* of the squad. Your profile as a *${interviewData.role}* is now live.\n\nI'm ready when you are. What's our first move?`;
        } else {
          // Update user status to 'pending' only if they weren't auto-approved
          await this.prisma.user.upsert({
            where: { telegramId: userId },
            update: { onboardingStatus: 'pending' },
            create: {
              telegramId: userId,
              displayName: interviewData.displayName,
              onboardingStatus: 'pending',
            },
          });
        }

        return finalReply;

      }

      // Otherwise, just save history and return response
      await this.prisma.onboardingSession.update({
        where: { id: session.id },
        data: { conversationJson: updatedHistory },
      });

      return response.text;
    } finally {
      // Release lock immediately after processing
      await this.redis.client.del(lockKey);
    }
  }
}
