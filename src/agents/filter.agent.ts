import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { Type } from '@google/genai';
import { ModelError } from '@app/common/types/errors';
import type { FilterDecision } from '@app/common/types/agent.types';
import type { ParsedMessage } from '@app/common/types/telegram.types';
import type { HotMemoryEntry } from '@app/common/types/agent.types';

/**
 * Filter Agent — Stage 2 of the pipeline.
 *
 * Uses gemini-3.1-flash-lite-preview (cheapest model — no thinking needed for routing).
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
     * @returns FilterDecision with action + optional reply/routeTo
     */
    async route(
        parsed: ParsedMessage,
        hotMessages: HotMemoryEntry[] = [],
    ): Promise<FilterDecision> {
        const messageText = parsed.text ?? '[media message]';

        const contextLines = hotMessages
            .slice(-5)
            .map((m) => `${m.role}: ${m.text}`)
            .join('\n');

        const systemPrompt = `You are Elena's message router. You decide what to do with each incoming message.
You are NOT the responder — you only decide routing.

Rules:
- If the message is casual/simple (greetings, small talk, simple questions about yourself): action = "reply" and provide a warm, concise reply as Elena.
- If the message requires research, coding, bounty management, brainstorming, or task management: action = "route" and specify the sub-agent.
- If the message is not directed at Elena or is irrelevant: action = "ignore".

Sub-agents available: manager, coder, reviewer, researcher, brainstorm, task

You MUST respond by calling the route_decision function.`;

        const userMessage = contextLines
            ? `Recent context:\n${contextLines}\n\nNew message from user ${parsed.userId}:\n${messageText}`
            : `New message from user ${parsed.userId}:\n${messageText}`;

        try {
            const response = await this.geminiService.generateContent(
                GEMINI_MODELS.FILTER,
                [{ role: 'user', parts: [{ text: userMessage }] }],
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

            // If model returned text instead of function call, treat as a direct reply
            if (response.text) {
                return {
                    action: 'reply',
                    reply: response.text,
                    reason: 'Model returned text instead of function call',
                };
            }

            return {
                action: 'ignore',
                reason: 'No actionable response from filter',
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
