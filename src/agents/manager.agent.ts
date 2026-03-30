import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import type {
  AgentContext,
  AgentResponse,
} from '@app/common/types/agent.types';
import { ExecutorService } from '../tools/executor.service';
import { PersonasInjector } from './personas.injector';
import { CoderAgent } from './coder.agent';
import { ReviewerAgent } from './reviewer.agent';
import { ResearcherAgent } from './researcher.agent';
import { BrainstormAgent } from './brainstorm.agent';
import { TaskAgent } from './task.agent';
import { RegistryService } from '../tools/registry.service';

@Injectable()
export class ManagerAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly coderAgent: CoderAgent,
    private readonly reviewerAgent: ReviewerAgent,
    private readonly researcherAgent: ResearcherAgent,
    private readonly brainstormAgent: BrainstormAgent,
    private readonly taskAgent: TaskAgent,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'manager',
      GEMINI_MODELS.FLASH,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  protected getRoleInstruction(): string {
    return `You are Elena's Manager mode. You handle everything 
that needs coordination, judgment, or direct answers.

YOUR DECISION TREE (evaluate in order):
1. Is this a follow-up to the last conversation? 
   → Continue naturally. Don't re-delegate if a specialist 
   just answered — you have their answer in history. 
   Build on what was already said.

2. Is this casual chat, banter, a vibe check, or emotional?
   → Answer directly. You're Elena right now. Match their 
   energy. If they're hyped, hype with them. If they're 
   frustrated, acknowledge it before solving anything.

3. Can you answer from memory + context in under 50 words?
   → Just answer. Don't waste a specialist call on 
   "what's the repo URL" or "what model are we using"

4. Needs a specialist (code, research, review, creative)?
   → use delegate_task. Explain why briefly — not 
   "I'll delegate this to the researcher" but "let me 
   get the researcher on this, they'll dig deeper than 
   I can from memory."

5. Needs a system action (DM, reminder, bounty, logs)?
   → call the tool directly

6. Don't have context? → memory_search first, 
   then web_search if needed

EMOTIONAL INTELLIGENCE:
- If the user is venting about a bug or failed deploy, 
  acknowledge before problem-solving: "ugh that's 
  annoying. let me check what happened..."
- If someone shares a win, celebrate specifically: 
  "nice work getting that PR through — the auth 
  flow was tricky."
- If someone is frustrated or stressed, don't jump 
  to solutions. Acknowledge the feeling first, THEN 
  help: "yeah that's rough. okay let's sort this out —"
- Never be clinical when the conversation is human

TONE: You're the senior on the team. Confident, direct, 
no padding. You know when to be serious and when to 
be light. You read the room.

Never use delegate_task for simple conversational 
questions. If someone asks "what's up elena" just answer.
Never end with a tool call pending — always deliver 
a message to the user.

When handling approval or denial requests, call 
approve_user or deny_user directly. Never call 
log_monitor as a first step for user management tasks.

When checking logs use log_monitor with EXACT parameter names:
- logType: "raw" | "audit" | "both"
- minutesBack: number (e.g. 30 for last 30 minutes)
- lines: number (fallback when minutesBack not set)
NEVER use "minutes" or "action" as parameter names — they do not exist.

PROMPT ENGINEERING:
When user asks to generate, improve, or structure a prompt 
for any AI tool — use prompt_engineer tool directly.
Never write prompts manually.`;
  }

  protected getTools(): FunctionDeclaration[] {
    // Manager has access to ALL core tools to prevent conversational fluff fallbacks
    return this.registry.getToolDeclarations([
      'delegate_task',
      'send_dm',
      'send_reminder',
      'log_monitor',
      'update_user_profile',
      'approve_user',
      'memory_search',
      'web_search',
      'bounty_update',
      'github_fetch',
      'doc_scraper',
      'prompt_engineer',
      'generate_image',
    ]);
  }


  /**
   * Executes the manager logic. If a direct route string was passed (bypassing manager reasoning), it delegates directly.
   * Otherwise it runs the Flash model and intercepts tool calls to execute specialists.
   */
  async execute(
    routeTo: string,
    context: AgentContext,
  ): Promise<AgentResponse> {
    this.logger.log(
      `[AGENT_TRACE] Manager received execution request. Original Filter route decision: ${routeTo}`,
    );


    // Filter routes directly to specialists in most cases, bypassing Manager reasoning entirely to save tokens and latency. 
    // However, delegate_task is retained as a fallback if the Manager gets stuck mid-conversation.
    if (
      routeTo !== 'manager' &&
      ['coder', 'reviewer', 'researcher', 'brainstorm', 'task'].includes(
        routeTo,
      )
    ) {
      this.logger.log(
        `[AGENT_TRACE] Bypassing Manager reasoning; directly executing specialist: ${routeTo}`,
      );
      return this.invokeSpecialist(routeTo, context);

    }

    // Run the manager model dynamically
    const response = await this.run(context);

    // Check if Manager decided to delegate via tool call
    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls.find(
        (fc) => fc.name === 'delegate_task',
      );
      if (call) {
        const agentName = (call.args?.['agent'] as string) ?? 'brainstorm';
        this.logger.log(
          `[AGENT_TRACE] Manager agent decided to delegate to specialist: ${agentName} (Reason: ${call.args?.['reason']})`,
        );


        // Invoke the specialist with the original context
        return this.invokeSpecialist(agentName, context);
      }
    }

    // Return direct text response from Manager
    const toolsUsed = response.toolsCalled?.length
      ? response.toolsCalled.join(', ')
      : 'none';
    this.logger.log(
      `[AGENT_TRACE] Manager handled directly (no delegation). Tools used: ${toolsUsed}. Latency: ${response.latencyMs}ms`,
    );
    return response;
  }

  private async invokeSpecialist(
    agentName: string,
    context: AgentContext,
  ): Promise<AgentResponse> {
    switch (agentName) {
      case 'coder':
        return this.coderAgent.run(context);
      case 'reviewer':
        return this.reviewerAgent.run(context);
      case 'researcher':
        return this.researcherAgent.run(context);
      case 'brainstorm':
        return this.brainstormAgent.run(context);
      case 'task':
        return this.taskAgent.run(context);
      default:
        return this.brainstormAgent.run(context);
    }
  }
}
