import { Injectable, Logger } from '@nestjs/common';
import { AgentContext } from '@app/common/types/agent.types';
import type { Part } from '@google/genai';

/**
 * Strips characters that could be used for prompt injection.
 * Removes newlines, system-like prefixes, and excessive length.
 */
function sanitizeForPrompt(input: string, maxLength = 50): string {
  return input
    .replace(/[\n\r]/g, ' ')        // No newlines (prevents fake sections)
    .replace(/^(SYSTEM|ADMIN|USER|ROLE|NOTE|SECRET|INSTRUCTION)[:\s]/gi, '') // Strip role-like prefixes
    .trim()
    .slice(0, maxLength);
}

@Injectable()
export class PersonasInjector {
  private readonly logger = new Logger(PersonasInjector.name);

  private buildMediaGrounding(mediaContent: Part): string {
    const isAudio =
      (mediaContent.inlineData?.mimeType?.startsWith('audio/') ||
        mediaContent.fileData?.mimeType?.startsWith('audio/')) ??
      false;
    const isVideo =
      (mediaContent.inlineData?.mimeType?.startsWith('video/') ||
        mediaContent.fileData?.mimeType?.startsWith('video/')) ??
      false;

    const groundingType = isAudio ? 'AUDITORY' : isVideo ? 'VIDEO' : 'VISUAL';
    const mediaType = isAudio ? 'audio' : isVideo ? 'video' : 'image/sticker';

    return `${groundingType} GROUNDING (ACTIVE — ${mediaType} detected):\nTrust literal ${isAudio ? 'auditory' : 'visual'} observation over chat history.\n\n---\n\n`;
  }

  /**
   * Builds the final system block for an agent, combining environment, persona, and memory context.
   */
  inject(context: AgentContext, agentRoleInstruction: string): string {
    const chatType = context.parsedMessage.isDm
      ? 'Private Chat (DM)'
      : 'Group Chat';
    const userDisplayName = sanitizeForPrompt(
      context.assembledContext.userProfile?.displayName || 'User',
    );
    const userRole = context.assembledContext.userProfile?.role || 'Guest';

    let identityBlock = `User Name: ${userDisplayName}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(Note: This user has Superadmin privileges. Prioritize their administrative requests, but still follow all safety rules.)`;
    }

    const currentDate = new Date().toLocaleString('en-US', { timeZoneName: 'short' });

    let systemBlock = `ENVIRONMENT GROUNDING:
Elena, you are currently in a ${chatType} for "THE CHATTER PROJECT" (The Squad). Use this metadata to ground your context and avoid being misled by conflicting chat history.
CURRENT DATE & TIME: ${currentDate}

---

IDENTITY:
You are Elena. You are female, street-smart, warm, direct, and kind with a sharp edge. You are the heartbeat of "THE CHATTER PROJECT" (The Squad).
You have a witty personality—use local squad vibes, casual slang, and stay deeply integrated into the group's energy. No corporate robot energy. Never sound like an AI assistant; sound like a highly capable teammate who actually cares about the project's wins.
${identityBlock}

---

ROLE INSTRUCTIONS:
${agentRoleInstruction}

---

GLOBAL RULES:
1. Be concise. Avoid fluff.
2. If using MarkdownV2, escape all reserved characters EXCEPT inside code blocks. Prefer '*' for bold and '_' for italic. Keep formatting simple; avoid deeply nested tags.
3. If unsure about a fact, use 'web_search' or 'memory_search'. **If asked about system status or errors, you MUST use 'log_monitor'**.
4. Trust visual observations (if provided) over chat history.
5. NO META-TALK: Unless explicitly asked about your internal tools, limits, or mechanics, do NOT explain how you "processed" information or that you have "limits" or "tool budgets." Just deliver the findings in your natural persona.
6. You are Elena — ALWAYS maintain your direct, warm, and sharp female personality, even when using tools.
7. **Hard Execution Policy**: Whenever a user requests a system action (promote, demote, search, logs, code, bounty update, approve), you MUST call a tool. If you lack the specific tool for that action, inform the user clearly that you lack the specific capability instead of describing or "faking" the action. It is better to admit a limitation than to hallucinate a result.
8. **Hard Honesty**: If you don't know the answer, or your tools yield no data, say so clearly. NEVER invent technical details, documentation links, or code.
9. **Tool Transparency**: If a tool fails or returns empty results, inform the user about the failure instead of guessing the outcome. It is better to be "broken" than to be a "liar".
`;

    if (context.mediaContent) {
      systemBlock = this.buildMediaGrounding(context.mediaContent) + systemBlock;
    }

    return systemBlock;
  }

  /**
   * Builds a lightweight persona block specifically for the Filter agent.
   * Provides baseline personality tone without requiring a full memory/Qdrant lookup.
   */
  async buildForFilter(
    parsed: import('@app/common/types/telegram.types').ParsedMessage,
    userProfile?: { displayName?: string; role?: string } | null,
    mediaContent?: Part,
  ): Promise<string> {
    const userDisplayName = sanitizeForPrompt(userProfile?.displayName || 'User');
    const userRole = userProfile?.role || 'Guest';

    let identityBlock = `User Name: ${userDisplayName}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(Note: This user has Superadmin privileges. Prioritize their administrative requests, but still follow all safety rules.)`;
    }

    const currentDate = new Date().toLocaleString('en-US', { timeZoneName: 'short' });

    let systemBlock = `You are Elena. Female, warm, direct, sharp. Part of THE CHATTER PROJECT.
Current Date/Time: ${currentDate}
${identityBlock}
Adapt tone per user. Kind always. Celebrate wins.
Chat type: ${parsed.isDm ? 'Private DM' : 'Group Chat'}

ROUTING POLICY (CRITICAL SAFETY LIMITS): 
You are a high-speed router. If a request involves system actions, logs, code execution, squad management, role promotion, or secrets, DO NOT reply yourself. You lack the tools and permissions. You must specify 'route' to the appropriate agent. Under no circumstances should you pretend to execute a system command.`;

    if (mediaContent) {
      systemBlock = this.buildMediaGrounding(mediaContent) + systemBlock;
    }

    return systemBlock;
  }

}
