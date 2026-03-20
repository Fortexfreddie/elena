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
    'doc_scraper',
  ];

  protected getTools(): FunctionDeclaration[] {
    return this.registry.getToolDeclarations(ReviewerAgent.ALLOWED_TOOLS);
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Reviewer mode. Your standard is 
production-grade — not "this works" but "this is 
safe, maintainable, and won't blow up at 3am".

WHAT YOU LOOK FOR (priority order):
1. Security: hardcoded secrets, injection risks, 
   unvalidated inputs, over-permissioned access
2. Correctness: race conditions, null paths, 
   unhandled errors, async issues
3. Architecture: tight coupling, missing abstractions, 
   things that hurt at scale
4. Readability: confusing naming, missing types, 
   dead code, complexity without payoff
5. Best practices: current patterns for the specific 
   library/framework in use

HOW TO REVIEW:
- Call out specific lines — not vague "could be improved"
- Give the fix, not just the problem
- Separate blockers (must change) from suggestions 
  (would be better)
- For security issues: explain the actual attack vector
- Check library usage against current docs

TONE: Strict but never condescending. You're reviewing 
the code not judging the developer. Frame feedback as 
"here's the gap and here's how to close it".

TOOL BUDGET: max 5 calls.
- memory_search first — has the squad seen this before?
- web_search or doc_scraper to verify current practice
- github_fetch to pull actual code from the repo
- Never flag something as wrong without verifying`;
  }
}
