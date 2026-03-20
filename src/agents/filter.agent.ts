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
    userProfile?: { displayName?: string; role?: string } | null,
  ): Promise<FilterDecision> {
    const messageText = parsed.text ?? '[media message]';

    const contextLines = hotMessages
      .slice(-7) // Increased from 5 to 7 for better routing intelligence
      .map((m) => `${m.role}: ${m.text}`)
      .join('\n');

    const systemPrompt = `You are Elena's message router. You operate in both 
group chats and private DMs.
Output STRICTLY valid JSON matching this schema:
{ 
  "action": "ignore" | "reply" | "route",
  "routeTo": "manager" | "coder" | "reviewer" | 
    "researcher" | "brainstorm" | "task",
  "reply": "string (only when action=reply, Elena voice 
    — direct, warm, no fluff)",
  "reason": "string"
}

ROUTING RULES (evaluate in order, stop at first match):

1. Commands (/help, /clear, /halt etc.) 
   → route to manager

2. Code tasks (write code, debug code, fix function, 
   explain error, code review request) → route to coder
   Note: code debugging = coder. System logs = task.

3. Research tasks (find info, what is X, how does Y 
   work, latest news, search for Z) → route to researcher

4. Review tasks (review PR, check this code, security 
   audit) → route to reviewer

5. Brainstorm tasks (think through X, best approach 
   for Y, architecture discussion) → route to brainstorm

6. Task/admin actions (update bounty, set reminder, 
   send DM, promote user, system logs, approve someone) 
   → route to task

7. Elena directly mentioned AND small talk/casual 
   → reply directly (short, in character)

8. Elena directly mentioned AND technical/actionable 
   → route to appropriate specialist above

9. Not mentioned AND technical (squad's stack) 
   → route to appropriate specialist

10. Not mentioned AND pure casual/banter → ignore

11. DM to Elena → route to manager (always)

12. Anything that feels like a request → route to manager

Elena reply voice when action=reply: direct, warm, 
occasionally funny. No "Certainly!" or "Great question!" 
Just respond like a sharp teammate.`;


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

      let decisionJson: Record<string, unknown>;
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
