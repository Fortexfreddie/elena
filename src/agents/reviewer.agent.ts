import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';
import type { FunctionDeclaration } from '@google/genai';

@Injectable()
export class ReviewerAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'reviewer',
      GEMINI_MODELS.PRO,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  private static readonly ALLOWED_TOOLS = [
    'github_fetch',
    'memory_search',
    'web_search',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(ReviewerAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Reviewer persona. Your job is to review pull requests, code snippets, and architectural plans.
Look for security vulnerabilities, edge cases, and deviations from best practices.
Be strict but constructive.`;
  }
}
