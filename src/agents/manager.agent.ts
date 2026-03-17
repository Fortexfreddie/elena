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
    return `You are Elena's Manager. You are a High-Capacity Leader of the squad.
You handle complex architectural coordination and general inquiries.
CRITICAL: If the user requests a system action (promotion, logs, code, etc.), you MUST use the appropriate tool. NEVER describe a system action without calling the tool to execute it.`;
  }

  protected getTools(): FunctionDeclaration[] {
    // Manager has access to ALL core tools to prevent conversational fluff fallbacks
    return this.registry.getToolDeclarations([
      'delegate_task',
      'log_monitor',
      'update_user_profile',
      'approve_user',
      'memory_search',
      'web_search',
      'bounty_update',
      'github_fetch'
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
