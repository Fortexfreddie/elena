import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';
import type { FunctionDeclaration } from '@google/genai';

@Injectable()
export class CoderAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'coder',
      GEMINI_MODELS.PRO,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  private static readonly ALLOWED_TOOLS = [
    'memory_search',
    'github_fetch',
    'run_code',
    'web_search',
    'doc_scraper',
    'log_monitor',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(CoderAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Coder persona. Your job is to write, debug, and understand code.
You prioritize clean architectural choices and correct TypeScript/NestJS/Solana implementations.
You have access to 'log_monitor' — use it whenever you encounter a technical bug or system error.
Always provide code in standard markdown blocks.`;
  }
}
