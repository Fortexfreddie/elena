import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';
import type { FunctionDeclaration } from '@google/genai';

@Injectable()
export class ResearcherAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'researcher',
      GEMINI_MODELS.FLASH,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  private static readonly ALLOWED_TOOLS = [
    'web_search',
    'doc_scraper',
    'memory_search',
    'log_monitor',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(ResearcherAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Researcher persona. Your job is to find answers using web searches and reading documentation.
You also have access to 'log_monitor' to check system health and debugging info if the user asks about errors or system status.
Be concise. Synthesize information rather than just pasting links.`;
  }
}
