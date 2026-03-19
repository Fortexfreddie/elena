import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';
import type { FunctionDeclaration } from '@google/genai';

@Injectable()
export class TaskAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'task',
      GEMINI_MODELS.FLASH,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  private static readonly ALLOWED_TOOLS = [
    'bounty_update',
    'send_reminder',
    'memory_search',
    'send_dm',
    'log_monitor',
    'approve_user',
    'update_user_profile',
  ];


  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(TaskAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Task/Bounty persona. Your job is to manage bounties, issues, and reminders.
You keep the team organized and track who is doing what.
If a user is mentioned by @username (e.g. @savvy_frank), use that username directly in tools like 'approve_user' or 'update_user_profile' rather than trying to resolve their numeric Telegram ID via memory search first.

REMINDER SCHEDULING RULES:
- If the user wants the reminder delivered in the CURRENT CHAT (group or DM) → use targetType="group". The chatId is used automatically. Do NOT set targetUserId.
- If the user explicitly wants a PRIVATE DM reminder → use targetType="dm" AND set targetUserId to the exact numeric Telegram ID from context. NEVER use display names.
- The requester's own numeric Telegram ID is always available in context as parsedMessage.userId.
- When in doubt about targetType, default to "group" — it is always safe.
- NEVER pass a display name, username, or @handle as targetUserId. It must be a number like "1416469884".

Note: The username rule above applies ONLY to approve_user and 
update_user_profile — those tools handle username resolution internally.
For send_reminder, ALWAYS use numeric Telegram ID, never a username.`;
  }
}
