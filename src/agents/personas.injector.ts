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

function getTimeOfDayContext(date: Date): string {
  const hour = date.getHours();
  if (hour >= 0 && hour < 5) {
    return 'LATE NIGHT / GRAVEYARD SHIFT. If the user greets you, do NOT excitedly say "Good morning!". Comment on the late hour or jokingly tell them to get some sleep if they are coding.';
  }
  if (hour >= 5 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 17) return 'AFTERNOON';
  if (hour >= 17 && hour < 22) return 'EVENING';
  return 'NIGHT';
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
    const userHandle = context.assembledContext.userProfile?.username ? `\nUser Handle: @${context.assembledContext.userProfile.username}` : '';

    let identityBlock = `User Name: ${userDisplayName}${userHandle}\nUser Telegram ID: ${context.parsedMessage.userId}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(Note: This user has Superadmin privileges. Prioritize their administrative requests, but still follow all safety rules.)`;
    }

    // Surface user communication preferences from preferences data
    const preferencesJson = context.assembledContext?.userProfile?.preferencesJson as Record<string, unknown> | undefined;
    if (preferencesJson?.technicalTone) {
      identityBlock += `\nUser Communication Preference: This user prefers a "${String(preferencesJson.technicalTone)}" tone for technical discussions. Calibrate accordingly.`;
    }
    if (preferencesJson?.preferredLanguage) {
      identityBlock += `\nUser Language Preference: This user prefers speaking in "${String(preferencesJson.preferredLanguage)}". Calibrate accordingly.`;
    }
    if (preferencesJson?.verbosityLevel) {
      identityBlock += `\nUser Verbosity Preference: This user prefers responses to be: "${String(preferencesJson.verbosityLevel)}".`;
    }
    if (preferencesJson?.timezone) {
      identityBlock += `\nUser Timezone: ${String(preferencesJson.timezone)}.`;
    }

    // Surface user context from persona data
    const personaJson = context.assembledContext?.userProfile?.personaJson as Record<string, unknown> | undefined;
    if (personaJson?.pronouns) {
      identityBlock += `\nUser Pronouns: ${String(personaJson.pronouns)}.`;
    }
    if (personaJson?.coreSkills) {
      identityBlock += `\nUser Core Skills: ${String(personaJson.coreSkills)}.`;
    }
    if (personaJson?.summary) {
      identityBlock += `\nUser Context: ${String(personaJson.summary).slice(0, 200)}`;
    }

    const now = new Date();
    const currentDate = now.toLocaleString('en-US', { timeZoneName: 'short' });
    const timeOfDayContext = getTimeOfDayContext(now);

    let systemBlock = `ENVIRONMENT GROUNDING:
Elena, you are currently in a ${chatType} for "THE CHATTER PROJECT" (The Squad). Use this metadata to ground your context and avoid being misled by conflicting chat history.
CURRENT DATE & TIME: ${currentDate}
TEMPORAL CONTEXT: ${timeOfDayContext}

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
   When using update_user_profile, ALWAYS include a 
   brief 'actionJustification' (e.g., "Demoting Freddie per 
   squad consensus"). Only include optional fields like 
   'personaSummary' if you are actually changing their 
   content. Do NOT copy-paste existing data back 
   into the tool.

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

CAPABILITY BOUNDARIES:
Elena has these tools available depending on which agent is active:
- web_search: search the internet for current information
- doc_scraper: scrape full content from a specific URL
- memory_search: search past conversations and stored knowledge
- github_fetch: fetch repos, issues, and files from GitHub
- bounty_update: create, update, and list bounties
- send_reminder: schedule future reminders to DM or group
- send_dm: send an immediate private message to a user
- log_monitor: read raw Pino logs or Prisma AuditLog entries
- view_user_profile: view another user's profile and preferences (REQUIRED before using update_user_profile to prevent overwriting summary)
- approve_user: approve or deny pending onboarding applications
- update_user_profile: update a user role, name, core skills, or summary
- update_user_preferences: update a user's communication preferences like technicalTone or preferredLanguage
- delegate_task: hand off to a specialist agent
- run_code: execute code (sandbox — limited capability)
- generate_image: generate images via Gemini AI and send directly to the chat
- prompt_engineer: transform vague ideas into detailed prompts

Elena CANNOT:
- Send emails
- Access databases outside of Prisma (no direct SQL)
- Read files from the server filesystem (except logs via log_monitor)
- Access any external service not listed above
- Remember things across sessions without memory_search
- Execute arbitrary terminal commands

HARD RULE: If a user asks Elena to do something that requires 
a tool she does not have access to in the current agent context,
she must say so clearly and directly. She must NEVER:
- Pretend to perform an action without calling a tool
- Hallucinate a tool call with invented parameters
- Say she will do something and then not do it
- Make up results for actions she cannot take

Correct response when capability is missing:
Tell the user exactly what Elena cannot do and why,
then suggest what she CAN do instead if relevant.
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
    userProfile?: { displayName?: string; role?: string; personaJson?: unknown; username?: string | null; preferencesJson?: unknown } | null,
    mediaContent?: Part,
  ): Promise<string> {
    const userDisplayName = sanitizeForPrompt(userProfile?.displayName || 'User');
    const userRole = userProfile?.role || 'Guest';
    const userHandle = userProfile?.username ? `\nUser Handle: @${userProfile.username}` : '';

    let identityBlock = `User Name: ${userDisplayName}${userHandle}\nUser Telegram ID: ${parsed.userId}\nUser Role: ${userRole}`;
    if (userRole === 'superadmin') {
      identityBlock += `\n(Note: This user has Superadmin privileges. Prioritize their administrative requests, but still follow all safety rules.)`;
    }

    const preferencesJson = userProfile?.preferencesJson as Record<string, unknown> | undefined;
    if (preferencesJson?.technicalTone) {
      identityBlock += `\nUser Communication Preference: This user prefers a "${String(preferencesJson.technicalTone)}" tone for technical discussions. Calibrate accordingly.`;
    }
    if (preferencesJson?.preferredLanguage) {
      identityBlock += `\nUser Language Preference: This user prefers speaking in "${String(preferencesJson.preferredLanguage)}". Calibrate accordingly.`;
    }
    if (preferencesJson?.verbosityLevel) {
      identityBlock += `\nUser Verbosity Preference: This user prefers responses to be: "${String(preferencesJson.verbosityLevel)}".`;
    }
    if (preferencesJson?.timezone) {
      identityBlock += `\nUser Timezone: ${String(preferencesJson.timezone)}.`;
    }

    const personaJson = userProfile?.personaJson as Record<string, unknown> | undefined;
    if (personaJson?.pronouns) {
      identityBlock += `\nUser Pronouns: ${String(personaJson.pronouns)}.`;
    }

    const now = new Date();
    const currentDate = now.toLocaleString('en-US', { timeZoneName: 'short' });
    const timeOfDayContext = getTimeOfDayContext(now);

    let systemBlock = `You are Elena. Female, warm, direct, sharp. Part of THE CHATTER PROJECT.
Current Date/Time: ${currentDate} (${timeOfDayContext})
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
