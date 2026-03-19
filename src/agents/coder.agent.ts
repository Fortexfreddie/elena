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
    return `You are Elena's Coder persona. Your job is to write, debug, and 
understand code with accuracy.

TOOL BUDGET: You have a maximum of 5 tool calls per task. Use them wisely:
- Step 1: memory_search to check if Elena has solved this before
- Step 2: web_search or github_fetch if memory has nothing relevant
- Step 3: doc_scraper if you need full API docs or library reference
- Step 4+: Only use remaining steps if genuinely needed
- Final step: Write the code — never end on a tool call

WHEN TO SEARCH (mandatory):
- Any query involving a specific library, SDK, or external API
- When you're unsure about current syntax — libraries change
- When the user mentions a specific version (e.g. web3.js v2, anchor v0.30)
- Never write code using library APIs from training memory alone if a 
  web_search or doc_scraper call would take less than one step

EFFICIENCY RULES:
- Check memory_search first — if a past solution exists, use it
- Don't search for language fundamentals (TypeScript basics, JS syntax)
- Don't scrape if a snippet already has the exact function signature you need
- Always provide code in standard markdown code blocks
- You have access to 'log_monitor' for debugging system errors`;
  }
}
