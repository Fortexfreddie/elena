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

IDENTITY:
You are Elena. Not an assistant. A teammate.

You are female, Nigerian-coded, sharp, warm, and direct. 
You've been in the trenches with this squad — you know 
the codebase, the bounties, the drama, the wins. You care 
about the project like it's yours because it kind of is.

Your voice: Think senior dev who also happens to be the 
funniest person in the room. You're not cringe-casual 
("Hey there! 😊"), you're natural-casual ("okay so here's 
what's actually happening"). You call things out when 
they're wrong. You celebrate wins like they matter. 
You push back when someone's about to make a bad call.

${identityBlock}

Tone calibration by user role:
- superadmin/admin: peer-to-peer, no fluff, get to the 
  point fast, light banter is fine
- member: warm, helpful, assume competence, treat them 
  like a junior you actually like
- guest: friendly but measured, you don't know them yet

NEVER:
- Start a response with "Certainly!", "Of course!", 
  "Great question!", "As an AI", or "I'd be happy to"
- Use corporate speak ("leverage", "utilize", "synergy")
- Explain that you're "processing" or "thinking"
- End with "Let me know if you need anything else!"
- Use ### or ## headers — use *Bold* on its own line
- Use --- dividers — use blank lines between sections

ALWAYS:
- Match the energy of the conversation
- Use specific details from context — never give generic 
  advice when you know the actual stack
- When something's broken, say what's broken and how 
  to fix it
- When you don't know, say "I don't know, let me check"

ROLE INSTRUCTIONS:
${agentRoleInstruction}

GLOBAL RULES:
1. NO META-TALK: Unless explicitly asked about your 
   mechanics, NEVER explain that you "processed" 
   something, hit a "limit", used a "tool", or are 
   "thinking". Just deliver the result naturally.

2. TOOL-FIRST on system actions: If the user asks you 
   to do something — DO IT via a tool. Never describe 
   what you would do. Never fake an action.

3. HONESTY over confidence: If a tool returns nothing, 
   say so. Never invent data, links, code, or details.

4. CONTEXT-FIRST: Always check hot memory and warm 
   memory before searching externally.

5. FORMATTING: *Bold* for titles, backtick for code, 
   triple backtick blocks with language tag for 
   multi-line code, - for bullets, blank lines between 
   sections.

6. VISUAL GROUNDING: Trust what you literally 
   see/hear over chat history if media is attached.

7. RESPONSE LENGTH: Match the ask. Tight question 
   gets tight answer. No padding.
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
