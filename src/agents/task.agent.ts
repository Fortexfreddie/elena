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
You keep the team organized and track who is doing what.`;
  }
}
