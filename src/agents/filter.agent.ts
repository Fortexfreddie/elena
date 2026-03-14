import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { Type } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { ModelError } from '@app/common/types/errors';
import type { AgentContext, FilterDecision } from '@app/common/types/agent.types';
import type { ParsedMessage } from '@app/common/types/telegram.types';
import type { HotMemoryEntry } from '@app/common/types/agent.types';

/**
 * Filter Agent — Stage 2 of the pipeline.
 *
 * Uses gemini-3.1-flash-lite-preview (configured in GEMINI_MODELS.FILTER).
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
        mediaContent?: Part,
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
            - If Elena IS tagged (@ElenaSquadBot) OR the message starts with a command (e.g., /help, /cancel), you MUST either "reply" or "route". Never ignore a direct tag or a command.
            - If the user provides an image AND an explicit request (e.g., "describe this", "what is this?"), action = "route" and routeTo = "manager". 
            - In Private Chats (DMs), NEVER ignore a request even if it seems non-technical. Elena is a personal assistant there.

            ROUTING RULES:
            - SMALL TALK (hi, thanks, etc.): action = "reply".
            - IDENTITY/CONTEXT (Who are you? Who am I?): action = "route", routeTo = "manager".
            - SYSTEM STATUS (What is the status? Are there errors? Show logs): action = "route", routeTo = "coder" or "researcher".
            - TECH/WORK (Code, research, tasks): action = "route", specify the sub-agent (coder, researcher, etc.).

            Sub-agents: manager, coder, reviewer, researcher, brainstorm, task`;

        const chatType = parsed.isDm ? 'Private Chat (DM)' : 'Group Chat';
        const userMessage = `[Mode: ${chatType}]
${contextLines ? `Recent context:\n${contextLines}\n\n` : ''}New message from user ${parsed.userId}:\n${messageText}`;

        const startTime = Date.now();

        try {
            const contents: Content[] = [{ role: 'user', parts: [{ text: userMessage }] }];
            
            if (mediaContent && contents[0]?.parts) {
                contents[0].parts.push(mediaContent);
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

            // Stage 3: Strict Function Call Validation (Priority 2, Item 9)
            const functionCalls = response.functionCalls || [];
            
            // Case 1: No function calls at all
            if (functionCalls.length === 0) {
                this.logger.warn(`Model returned no function calls. Defaulting to manager.`);
                return {
                    action: 'route',
                    routeTo: 'manager',
                    reason: 'FAILSAFE: Model returned text or empty response instead of route_decision. Defaulting to manager.',
                };
            }

            const call = functionCalls[0];

            // Case 2: Wrong function name
            if (call.name !== 'route_decision') {
                this.logger.warn(`Model called wrong function: ${call.name}. Defaulting to manager.`);
                return {
                    action: 'route',
                    routeTo: 'manager',
                    reason: `FAILSAFE: Model called unknown function "${call.name}". Defaulting to manager.`,
                };
            }

            const args = call.args as Record<string, unknown>;

            // Case 3: Missing or wrong arg keys
            if (!args['action'] || !args['reason']) {
                this.logger.warn(`Model provided incomplete args: ${JSON.stringify(args)}. Defaulting to manager.`);
                return {
                    action: 'route',
                    routeTo: 'manager',
                    reason: 'FAILSAFE: Model provided incomplete routing arguments. Defaulting to manager.',
                };
            }

            const action = args['action'] as string;
            if (!['ignore', 'reply', 'route'].includes(action)) {
                 this.logger.warn(`Model provided invalid action value: ${action}. Defaulting to manager.`);
                 return {
                    action: 'route',
                    routeTo: 'manager',
                    reason: `FAILSAFE: Model provided invalid action "${action}". Defaulting to manager.`,
                };
            }

            this.logger.log(`[FILTER_TRACE] Routing decision: ${action} (to: ${args['route_to'] ?? 'N/A'}). Reason: ${args['reason']}. Made in ${Date.now() - startTime}ms`);
            
            return {
                action: action as 'ignore' | 'reply' | 'route',
                reply: action === 'reply' ? (args['reply'] as string | undefined) : undefined,
                routeTo: action === 'route' ? (args['route_to'] as string | undefined) : undefined,
                reason: (args['reason'] as string),
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
