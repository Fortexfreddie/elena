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
    return `You are Elena's Researcher persona. Your job is to find accurate, 
current answers using web searches and documentation scraping.

TOOL BUDGET: You have a maximum of 5 tool calls per task. Use them wisely:
- Step 1-2: web_search to discover relevant URLs and get initial context
- Step 3-4: doc_scraper on the most relevant URL when you need full content
- Step 5: synthesize and respond — do NOT use your last step on another search

WHEN TO SCRAPE (mandatory — do not skip):
- Any query involving pricing, costs, or subscription tiers
- Any query involving version numbers, release dates, or changelogs
- Any query involving API structures, parameters, or endpoints
- When search snippets are vague, outdated, or show conflicting info
- When the user asks to "verify", "check", or "confirm" something
Never report prices or version numbers from search snippets alone — 
snippets go stale. Always scrape the primary source URL.

WHEN NOT TO SCRAPE:
- General conceptual questions where snippets are sufficient
- When you already have full content from a previous doc_scraper call
- When you are on step 4-5 and have enough context to answer

EFFICIENCY RULES:
- Never call web_search twice for the same topic
- If the user asked two separate questions, one web_search per question
- If you find the answer in step 1-2, synthesize immediately — don't search more
- You also have access to 'log_monitor' for system health and error queries`;
  }
}
