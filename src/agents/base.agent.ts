import { Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { ModelError } from '@app/common/types/errors';
import type {
  AgentContext,
  AgentResponse,
} from '@app/common/types/agent.types';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { GeminiModel } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { PersonasInjector } from './personas.injector';
import { MAX_TOOL_CALLS } from '@app/common/gemini/gemini.constants';

export abstract class BaseAgent {
  protected readonly logger: Logger;

  constructor(
    protected readonly name: string,
    protected readonly defaultModel: GeminiModel,
    protected readonly geminiService: GeminiService,
    protected readonly executorService: ExecutorService,
    protected readonly personasInjector: PersonasInjector,
  ) {
    this.logger = new Logger(name);
  }

  protected abstract getRoleInstruction(): string;

  protected getTools(): FunctionDeclaration[] {
    return [];
  }

  protected buildSystemInstruction(context: AgentContext): string {
    // PersonasInjector handles the heavy lifting
    return this.personasInjector.inject(context, this.getRoleInstruction());
  }

  protected formatHistory(context: AgentContext): Content[] {
    return context.assembledContext.hotMessages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));
  }

  async run(context: AgentContext): Promise<AgentResponse> {
    const startTime = Date.now();
    const systemInstruction = this.buildSystemInstruction(context);
    const history = this.formatHistory(context);
    const tools = this.getTools();
    const toolsCalled: string[] = [];
    const collectedFunctionCalls: import('@google/genai').FunctionCall[] = [];

    const userMessageParts: Content['parts'] = [
      { text: context.parsedMessage.text ?? '' },
    ];
    if (context.mediaContent) {
      userMessageParts.push(context.mediaContent);
    }
    history.push({ role: 'user', parts: userMessageParts });

    let iterations = 0;
    const callContextHashes = new Set<string>();

    try {
      while (iterations < MAX_TOOL_CALLS) {
        iterations++;
        const response = await this.geminiService.generateContent(
          this.defaultModel,
          history,
          {
            systemInstruction,
            tools:
              tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
          },
        );

        history.push(response.rawContent);

        if (!response.functionCalls || response.functionCalls.length === 0) {
          const latencyMs = Date.now() - startTime;
          this.logger.log(
            `[EXECUTION_TRACE] Agent '${this.name}' completed in ${latencyMs}ms using model '${response.model}'. Tools called: ${toolsCalled.length > 0 ? toolsCalled.join(', ') : 'None'}`,
          );
          return {
            text: response.text,
            agentName: this.name,
            modelUsed: response.model,
            latencyMs,
            confidence: 90,
            toolsCalled,
            functionCalls:
              collectedFunctionCalls.length > 0
                ? collectedFunctionCalls
                : undefined,
          };
        }

        const toolResponseParts: Content['parts'] = [];
        let isSuspended = false;

        // Loop-stuck detection: check if this call-set has been seen in this execution loop
        const currentCallHash = JSON.stringify(
          response.functionCalls.map((c) => ({ name: c.name, args: c.args })),
        );

        if (callContextHashes.has(currentCallHash)) {
          this.logger.warn(
            `Stuck loop detected in ${this.name}: duplicate tool calls.`,
          );
          const latencyMs = Date.now() - startTime;
          return {
            text: `I'm noticing I'm repeating the same tool calls without progress. Stopping here. Gathered: ${toolsCalled.join(', ')}`,
            agentName: this.name,
            modelUsed: response.model,
            latencyMs,
            confidence: 40,
            toolsCalled,
            functionCalls:
              collectedFunctionCalls.length > 0
                ? collectedFunctionCalls
                : undefined,
          };
        }
        callContextHashes.add(currentCallHash);

        for (const call of response.functionCalls) {
          this.logger.log(`Executing tool: ${call.name}`);
          toolsCalled.push(call.name);
          collectedFunctionCalls.push(
            call as import('@google/genai').FunctionCall,
          );
          const result = await this.executorService.executeCall(call, context);

          if (result.suspended) {
            isSuspended = true;
            this.logger.log(`Tool loop suspended by ${call.name}`);
          }

          if (result.terminateLoop) {
            this.logger.log(`Tool loop terminated by ${call.name}`);
            return {
              text: response.text || 'Task delegated or terminal action taken.',
              agentName: this.name,
              modelUsed: response.model,
              latencyMs: Date.now() - startTime,
              confidence: 100,
              toolsCalled,
              functionCalls:
                collectedFunctionCalls.length > 0
                  ? collectedFunctionCalls
                  : undefined,
            };
          }

          toolResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result },
            },
          });
        }
        history.push({ role: 'user', parts: toolResponseParts });

        if (isSuspended) {
          const latencyMs = Date.now() - startTime;
          return {
            text: response.text ?? 'Action suspended awaiting confirmation.',
            agentName: this.name,
            modelUsed: response.model,
            latencyMs,
            confidence: 100,
            toolsCalled,
            functionCalls:
              collectedFunctionCalls.length > 0
                ? collectedFunctionCalls
                : undefined,
          };
        }
      }

      // Fallback for reaching max iterations
      const latencyMs = Date.now() - startTime;
      this.logger.warn(
        `Agent [${this.name}] reached max iterations (${MAX_TOOL_CALLS}).`,
      );

      return {
        text: `The task reached the maximum execution limit (${MAX_TOOL_CALLS} steps). I've gathered some information but need to stop here to avoid a loop. Please let me know if you'd like me to continue or try a different approach.`,
        agentName: this.name,
        modelUsed: this.defaultModel,
        latencyMs,
        confidence: 50,
        toolsCalled,
        functionCalls:
          collectedFunctionCalls.length > 0
            ? collectedFunctionCalls
            : undefined,
      };
    } catch (error: unknown) {
      const isSafetyBlock = error instanceof ModelError && error.message.includes('PROHIBITED_CONTENT');
      
      if (isSafetyBlock) {
        this.logger.warn(`Agent ${this.name} hit PROHIBITED_CONTENT block. Returning safety rejection.`);
        return {
          text: "I'm sorry, my safety filters blocked my reasoning for this task. I can't proceed with that specific request as it is currently phrased.",
          agentName: this.name,
          modelUsed: this.defaultModel,
          latencyMs: Date.now() - startTime,
          confidence: 0,
          toolsCalled,
        };
      }

      this.logger.error(`Execution failed for ${this.name}: ${error}`);
      throw error;
    }
  }
}
