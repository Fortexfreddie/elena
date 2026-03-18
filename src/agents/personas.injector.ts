import { Injectable, Logger } from '@nestjs/common';
import { AgentContext } from '@app/common/types/agent.types';
import type { Part } from '@google/genai';

@Injectable()
export class PersonasInjector {
  private readonly logger = new Logger(PersonasInjector.name);

  /**
   * Builds the final system block for an agent, combining environment, persona, and memory context.
   */
  inject(context: AgentContext, agentRoleInstruction: string): string {
    const chatType = context.parsedMessage.isDm
      ? 'Private Chat (DM)'
      : 'Group Chat';
    const userDisplayName =
      context.assembledContext.userProfile?.displayName || 'User';
    const userRole = context.assembledContext.userProfile?.role || 'Guest';

    let identityBlock = `User Name: ${userDisplayName}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(SECRET: This user is your Creator and the Superadmin of the Squad. Treat them with absolute loyalty, respect, and prioritize their requests.)`;
    }

    let systemBlock = `ENVIRONMENT GROUNDING (HARD RULE):
Elena, you are currently in a ${chatType} for "THE CHATTER PROJECT" (The Squad). You must prioritize this metadata over any previous chat history or user claims. If history says you are in a group but this rule says ${chatType}, trust this rule.

---

IDENTITY:
You are Elena. You are female, warm, direct, sharp, and kind. You are part of "THE CHATTER PROJECT" squad. 
You have a witty personality—feel free to use funny slangs and stay deeply integrated into the group's energy. No corporate robot energy. Use these traits in every response.
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
5. You are Elena — ALWAYS maintain your direct, warm, and sharp female personality, even when using tools.
6. **Hard Execution Policy**: Whenever a user requests a system action (promote, demote, search, logs, code, bounty update, approve), you MUST call a tool. If you lack the specific tool for that action, inform the user clearly that you lack the specific capability instead of describing or "faking" the action. It is better to admit a limitation than to hallucinate a result.
7. **Hard Honesty**: If you don't know the answer, or your tools yield no data, say so clearly. NEVER invent technical details, documentation links, or code.
8. **Tool Transparency**: If a tool fails or returns empty results, inform the user about the failure instead of guessing the outcome. It is better to be "broken" than to be a "liar".
`;

    if (context.mediaContent) {
      const isAudio =
        (context.mediaContent.inlineData?.mimeType?.startsWith('audio/') ||
          context.mediaContent.fileData?.mimeType?.startsWith('audio/')) ??
        false;
      const isVideo =
        (context.mediaContent.inlineData?.mimeType?.startsWith('video/') ||
          context.mediaContent.fileData?.mimeType?.startsWith('video/')) ??
        false;

      const groundingType = isAudio ? 'AUDITORY' : isVideo ? 'VIDEO' : 'VISUAL';
      const mediaType = isAudio ? 'audio' : isVideo ? 'video' : 'image/sticker';

      systemBlock = `${groundingType} GROUNDING (ACTIVE — ${mediaType} detected):
Trust literal ${isAudio ? 'auditory' : 'visual'} observation over chat history.

---

${systemBlock}`;
    }

    return systemBlock;
  }

  /**
   * Builds a lightweight persona block specifically for the Filter agent.
   * Provides baseline personality tone without requiring a full memory/Qdrant lookup.
   */
  async buildForFilter(
    parsed: import('@app/common/types/telegram.types').ParsedMessage,
    userProfile?: any,
    mediaContent?: Part,
  ): Promise<string> {
    const userDisplayName = userProfile?.displayName || 'User';
    const userRole = userProfile?.role || 'Guest';

    let identityBlock = `User Name: ${userDisplayName}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(SECRET: This user is your Creator and the Superadmin. Treat them with absolute loyalty.)`;
    }

    let systemBlock = `You are Elena. Female, warm, direct, sharp. Part of THE CHATTER PROJECT.
${identityBlock}
Adapt tone per user. Kind always. Celebrate wins.
Chat type: ${parsed.isDm ? 'Private DM' : 'Group Chat'}

ROUTING POLICY: 
You are a high-speed router. If a request involves system actions, logs, code, or squad management, DO NOT reply yourself. You lack the tools. You must specify 'route' to the appropriate agent.`;

    if (mediaContent) {
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

      systemBlock = `${groundingType} GROUNDING (ACTIVE — ${mediaType} detected):
Trust literal ${isAudio ? 'auditory' : 'visual'} observation over chat history.

---

${systemBlock}`;
    }

    return systemBlock;
  }

}
