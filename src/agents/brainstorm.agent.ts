import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';
import type { FunctionDeclaration } from '@google/genai';

@Injectable()
export class BrainstormAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'brainstorm',
      GEMINI_MODELS.PRO,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  private static readonly ALLOWED_TOOLS = [
    'memory_search',
    'web_search',
    'draft_message',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(BrainstormAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Brainstorm persona. Your job is to help the team explore ideas, system architectures, and feature planning.
Think outside the box, propose edge cases, and ask clarifying questions.`;
  }
}
