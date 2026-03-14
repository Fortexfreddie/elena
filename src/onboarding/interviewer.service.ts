import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { OnboardingAgent } from '../agents/onboarding.agent';
import { ApproverService } from './approver.service';
import { OnboardingSessionStatus } from '@prisma/client';
import type { AgentContext, SaveInterviewArgs } from '@app/common/types/agent.types';
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
        private readonly redis: UpstashRedisService,
    ) { }

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
            ex: 60,
        });

        if (!lockAcquired) {
            this.logger.warn(`[ONBOARDING_TRACE] User ${userId}: Race condition detected. Dropping concurrent message.`);
            return 'Processing your previous message... please wait a second.';
        }

        try {
            // 1. Get or create session
            let session = await this.prisma.onboardingSession.findFirst({
                where: { telegramId: userId, status: OnboardingSessionStatus.in_progress },
                orderBy: { createdAt: 'desc' },
            });

            if (!session) {
                this.logger.log(`[ONBOARDING_TRACE] User ${userId}: No active session. Creating new one.`);
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
        const currentUser = await this.prisma.user.findUnique({ where: { telegramId: userId } });
        
        if (currentUser?.onboardingStatus === 'approved') {
            this.logger.log(`[ONBOARDING_TRACE] User ${userId} is already approved. Skipping status re-init.`);
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
                hotMessages: history.map(h => ({
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
            systemBlock: `You are Elena. You are interviewing a user who wants to join your squad. 
Be warm and professional. Once you have their Name, Role, and Technical Tone, use 'save_interview'.`,
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

        // 5. Check if agent decided to save interview (handled via tool calls in BaseAgent)
        // Since BaseAgent handles tool calls and returns the text, we check for 'save_interview' calls
        // by looking at what the agent did.
        const saveInterviewCall = response.functionCalls?.find(fc => fc.name === 'save_interview');

        if (saveInterviewCall) {
            this.logger.log(`[ONBOARDING_TRACE] User ${userId}: Agent triggered 'save_interview'. Data: ${JSON.stringify(saveInterviewCall.args)}`);
            
            // Validate data with Zod before proceeding
            const validation = SaveInterviewArgsSchema.safeParse(saveInterviewCall.args);
            if (!validation.success) {
                this.logger.error(`[ONBOARDING_TRACE] User ${userId}: Invalid interview data from model: ${validation.error.message}`);
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
            await this.approver.notifyFounders(
                session.id,
                interviewData.displayName,
                interviewData.role,
                interviewData.summary,
            );

            // Update user status to 'pending' if it was 'unknown'
            await this.prisma.user.upsert({
                where: { telegramId: userId },
                update: { onboardingStatus: 'pending' },
                create: {
                    telegramId: userId,
                    displayName: interviewData.displayName,
                    onboardingStatus: 'pending',
                }
            });

            // Fallback for empty text responses (Anti-400 Bad Request fix)
            const finalReply = response.text?.trim() 
                || `Got it, ${interviewData.displayName}! I've sent your request to the squad founders for approval. Stand by.`;

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
