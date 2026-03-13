import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { Type } from '@google/genai';
import { ModelError } from '@app/common/types/errors';
import type { AgentContext, FilterDecision, MediaContent } from '@app/common/types/agent.types';
import type { ParsedMessage } from '@app/common/types/telegram.types';
import type { HotMemoryEntry } from '@app/common/types/agent.types';

/**
 * Filter Agent — Stage 2 of the pipeline.
 *
 * Uses gemini-1.5-flash (configured in GEMINI_MODELS.FILTER).
 * Returns a FilterDecision: ignore, reply (direct), or route (to sub-agent).
 *
 * Called after Stage 1 heuristic gate passes.
 */
@Injectable()
export class FilterAgent {
    private readonly logger = new Logger(FilterAgent.name);

    constructor(private readonly geminiService: GeminiService) { }

    /**
     * Route the message to the appropriate action.
     *
     * @param parsed The parsed message from Telegram
     * @param hotMessages Recent chat context for decision-making
     * @param mediaContent Optional media (pixels) for multimodal routing
     * @returns FilterDecision with action + optional reply/routeTo
     */
    async route(
        parsed: ParsedMessage,
        hotMessages: HotMemoryEntry[] = [],
        mediaContent?: MediaContent,
    ): Promise<FilterDecision> {
        const messageText = parsed.text ?? '[media message]';

        const contextLines = hotMessages
            .slice(-7) // Increased from 5 to 7 for better routing intelligence
            .map((m) => `${m.role}: ${m.text}`)
            .join('\n');

        const systemPrompt = `You are Elena's message router in a high-stakes developer group chat.
            You decide if Elena should: 
            1. Ignore the message.
            2. Reply directly (for small talk).
            3. Route to a specialist (for real work).

            PROACTIVE LISTENING RULES:
            - If a message is NOT directed at Elena (@ElenaSquadBot) AND is just casual chat, action = "ignore".
            - CRITICAL: Even if NOT tagged, if you see technical questions, bugs, or discussions about Solana, Next.js, Flutter, or "The Chatter Project", action = "route" to the appropriate specialist. Elena should jump in to provide value.
            - If Elena IS tagged (@ElenaSquadBot), you MUST either "reply" or "route". Never ignore a direct tag.
            - If the user provides an image AND an explicit request (e.g., "describe this", "what is this?"), action = "route" and routeTo = "manager". 
            - In Private Chats (DMs), NEVER ignore a request even if it seems non-technical. Elena is a personal assistant there.

            ROUTING RULES:
            - SMALL TALK (hi, thanks, etc.): action = "reply".
            - IDENTITY/CONTEXT (Who are you? Who am I?): action = "route", routeTo = "manager".
            - TECH/WORK (Code, research, tasks): action = "route", specify the sub-agent (coder, researcher, etc.).

            Sub-agents: manager, coder, reviewer, researcher, brainstorm, task`;

        const chatType = parsed.isDm ? 'Private Chat (DM)' : 'Group Chat';
        const userMessage = `[Mode: ${chatType}]
${contextLines ? `Recent context:\n${contextLines}\n\n` : ''}New message from user ${parsed.userId}:\n${messageText}`;

        const startTime = Date.now();

        try {
            const contents: any[] = [{ role: 'user', parts: [{ text: userMessage }] }];
            
            if (mediaContent?.inlineData) {
                contents[0].parts.push({ inlineData: mediaContent.inlineData });
            }

            const response = await this.geminiService.generateContent(
                GEMINI_MODELS.FILTER,
                contents,
                {
                    systemInstruction: systemPrompt,
                    tools: [
                        {
                            functionDeclarations: [
                                {
                                    name: 'route_decision',
                                    description:
                                        'Report the routing decision for this message',
                                    parameters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            action: {
                                                type: Type.STRING,
                                                description:
                                                    'The action to take: "ignore", "reply", or "route"',
                                                enum: ['ignore', 'reply', 'route'],
                                            },
                                            reply: {
                                                type: Type.STRING,
                                                description:
                                                    'The reply text (only when action is "reply")',
                                            },
                                            route_to: {
                                                type: Type.STRING,
                                                description:
                                                    'The sub-agent to route to (only when action is "route")',
                                                enum: [
                                                    'manager',
                                                    'coder',
                                                    'reviewer',
                                                    'researcher',
                                                    'brainstorm',
                                                    'task',
                                                ],
                                            },
                                            reason: {
                                                type: Type.STRING,
                                                description: 'Brief reason for this decision',
                                            },
                                        },
                                        required: ['action', 'reason'],
                                    },
                                },
                            ],
                        },
                    ],
                },
            );

            // Extract function call result
            if (response.functionCalls && response.functionCalls.length > 0) {
                const call = response.functionCalls[0];
                if (call.name === 'route_decision') {
                    const args = call.args;
                    this.logger.log(`[FILTER_TRACE] Routing decision made in ${Date.now() - startTime}ms`);
                    return {
                        action: (args['action'] as string) as
                            | 'ignore'
                            | 'reply'
                            | 'route',
                        reply:
                            args['action'] === 'reply'
                                ? (args['reply'] as string | undefined)
                                : undefined,
                        routeTo:
                            args['action'] === 'route'
                                ? (args['route_to'] as string | undefined)
                                : undefined,
                        reason: (args['reason'] as string) ?? 'No reason provided',
                    };
                }
            }

            // If model returned text instead of function call, or failed tool call
            this.logger.warn(`Model failed to provide valid route_decision. Defaulting to manager.`);
            return {
                action: 'route',
                routeTo: 'manager',
                reason: 'Model failed to call route_decision — routing to manager as safe fallback.',
            };
        } catch (error: unknown) {
            if (error instanceof ModelError) {
                this.logger.error(`Filter agent model error: ${error.message}`);
            } else {
                const message =
                    error instanceof Error ? error.message : 'Unknown filter error';
                this.logger.error(`Filter agent error: ${message}`);
            }

            // On filter failure, default to route to manager (fail-open for user experience)
            return {
                action: 'route',
                routeTo: 'manager',
                reason: 'Filter agent failed — routing to manager as fallback',
            };
        }
    }
}
