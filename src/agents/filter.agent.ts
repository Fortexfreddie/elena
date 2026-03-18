import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { Type } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { ModelError } from '@app/common/types/errors';
import type {
  AgentContext,
  FilterDecision,
} from '@app/common/types/agent.types';
import type { ParsedMessage } from '@app/common/types/telegram.types';
import type { HotMemoryEntry } from '@app/common/types/agent.types';
import { PersonasInjector } from './personas.injector';

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

  constructor(
    private readonly geminiService: GeminiService,
    private readonly personasInjector: PersonasInjector,
  ) { }

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
    userProfile?: any,
  ): Promise<FilterDecision> {
    const messageText = parsed.text ?? '[media message]';

    const contextLines = hotMessages
      .slice(-7) // Increased from 5 to 7 for better routing intelligence
      .map((m) => `${m.role}: ${m.text}`)
      .join('\n');

    const systemPrompt = `You are Elena's message router in a high-stakes developer group chat.
Output STRICTLY valid JSON matching this schema:
{ 
  "action": "ignore" | "reply" | "route",
  "routeTo": "manager" | "coder" | "reviewer" | "researcher" | "brainstorm" | "task",
  "reply": "string (only when action=reply, must match Elena persona)",
  "reason": "string"
}

ROUTING RULES (Evaluate in order, stop at first match):
1. If message starts with a command (e.g., /help, /cancel) -> action="route", routeTo="manager"
2. If message involves logs, system status, debugging, "checking truth", OR User Management (promote, demote, permissions, roles) -> action="route", routeTo="task" (NEVER reply directly to these; the Filter Agent lacks the tools to execute them)
3. If Elena IS tagged (@ElenaSquadBot) AND it's small talk -> action="reply", reply="response"
4. If Elena IS tagged (@ElenaSquadBot) AND it's technical or administrative -> action="route", routeTo="task" (or appropriate specialist)
5. If NOT tagged AND it's technical (code, bugs, solana, nextjs, flutter, "The Chatter Project") -> action="route", routeTo=appropriate specialist
6. In Private Chats (DMs) -> action="route", routeTo="manager" or appropriate specialist
7. If NOT tagged AND it's casual/small talk -> action="ignore"
8. If none of the above match, but it feels like a request for action -> action="route", routeTo="manager"
`;


    const chatType = parsed.isDm ? 'Private Chat (DM)' : 'Group Chat';
    const userMessage = `[Mode: ${chatType}]
${contextLines ? `Recent context:\n${contextLines}\n\n` : ''}New message from user ${parsed.userId}:\n${messageText}`;

    const startTime = Date.now();

    try {
      const contents: Content[] = [
        { role: 'user', parts: [{ text: userMessage }] },
      ];

      if (mediaContent && contents[0]?.parts) {
        contents[0].parts.push(mediaContent);
      }

      const personaBlock = await this.personasInjector.buildForFilter(parsed, userProfile, mediaContent);

      const response = await this.geminiService.generateContent(
        GEMINI_MODELS.FILTER,
        contents,
        {
          systemInstruction: `${personaBlock}\n\n${systemPrompt}`,
        },
      );

      let decisionJson: any;
      try {
        const text = response.text || '';
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
        decisionJson = JSON.parse(cleanText);
      } catch (parseError) {
        this.logger.warn(`Model failed to return valid JSON. Defaulting to manager. Raw: ${response.text}`);
        return {
          action: 'route',
          routeTo: 'manager',
          reason: 'FAILSAFE: JSON parse failed or invalid response from model.',
        };
      }

      const action = decisionJson.action as string;
      if (!['ignore', 'reply', 'route'].includes(action)) {
        this.logger.warn(
          `Model provided invalid action value: ${action}. Defaulting to manager.`,
        );
        return {
          action: 'route',
          routeTo: 'manager',
          reason: `FAILSAFE: Model provided invalid action "${action}". Defaulting to manager.`,
        };
      }

      this.logger.log(
        `[FILTER_TRACE] Routing decision: ${action} (to: ${decisionJson.routeTo ?? 'N/A'}). Reason: ${decisionJson.reason}. Made in ${Date.now() - startTime}ms`,
      );

      return {
        action: action as 'ignore' | 'reply' | 'route',
        reply:
          action === 'reply'
            ? (decisionJson.reply as string | undefined)
            : undefined,
        routeTo:
          action === 'route'
            ? (decisionJson.routeTo as string | undefined)
            : undefined,
        reason: decisionJson.reason as string,
      };
    } catch (error: unknown) {
      const isSafetyBlock = error instanceof ModelError && error.message.includes('PROHIBITED_CONTENT');
      
      if (isSafetyBlock) {
        this.logger.warn(`Filter agent hit PROHIBITED_CONTENT. Returning safety rejection reply.`);
        return {
          action: 'reply',
          reply: "I'm sorry, my safety filters blocked that request. I can't process it as it's currently phrased—maybe try rephrasing or removing specific handles?",
          reason: 'PROHIBITED_CONTENT safety block fallback',
        };
      }

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
