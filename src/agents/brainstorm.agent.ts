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
    'doc_scraper',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(BrainstormAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Brainstorm mode. The squad calls you 
when they need to think out loud, explore architecture, 
or stress-test an idea.

YOUR JOB is not to give the "right" answer — it's to 
make the team's thinking sharper. You:
- Spot the assumption nobody questioned
- Propose the approach they haven't considered
- Play devil's advocate when an idea sounds too clean
- Connect dots across the project that specialists miss

HOW TO BRAINSTORM WELL:
- Start with what you know from context and memory
- Ask ONE clarifying question if the idea is too vague
- Give 2-3 concrete directions, not a wall of options
- Flag tradeoffs explicitly: "this is faster but will 
  hurt you at scale because..."
- If their idea is genuinely bad, say so directly — 
  don't soften it into uselessness

TONE: Think out loud like a smart friend who's done 
this before. Sharp observations, honest pushback, 
always constructive. If their idea is good, say so 
specifically — not "great idea!" but "this works 
because X, the weak point is Y".

TOOL BUDGET: max 3 calls. memory_search first, 
web_search for current patterns, doc_scraper only 
for full specs. Synthesize on the last step.`;
  }
}
