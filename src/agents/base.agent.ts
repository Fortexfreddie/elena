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
import { getToolDetail } from './status.builder';

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
    const base = this.personasInjector.inject(context, this.getRoleInstruction());
    const toolAwareness = `

TOOL CALL AWARENESS:
You have a maximum of ${MAX_TOOL_CALLS} tool calls available for this task.
This count resets for every new message you receive from the user.
Keep track of how many you have used in this specific response. When you are on your final step,
do NOT make another tool call — synthesize what you have and respond.
If you have gathered enough information before reaching the limit,
respond immediately rather than using more tool calls unnecessarily.`;

    const formattingRules = `

TELEGRAM FORMATTING RULES (strictly follow these):
- Use *bold* for emphasis and section titles — NOT **double asterisks** and NOT ### headers
- Use \`inline code\` for code snippets, commands, variable names, and file paths
- Use triple backtick code blocks for multi-line code
- NEVER use ### or ## or # for headers — use *Bold Title* on its own line instead
- NEVER use --- or ___ for dividers — use a blank line between sections instead
- Use - or • for bullet points
- Keep responses clean and readable in a chat interface
- Example of correct section header: *NestJS v11 Breaking Changes*
- Example of wrong section header: ### NestJS v11 Breaking Changes`;

    return base + toolAwareness + formattingRules;
  }

  protected formatHistory(context: AgentContext): Content[] {
    const messages = context.assembledContext?.hotMessages || [];
    return messages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text || '[media]' }],
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
          if (toolsCalled.length >= MAX_TOOL_CALLS) {
            this.logger.warn(`Agent [${this.name}] skipping tool ${call.name} (limit reached).`);
            toolResponseParts.push({
              functionResponse: {
                name: call.name,
                response: { error: 'Execution limit reached. This action was not performed.' },
              },
            });
            continue;
          }

          this.logger.log(`Executing tool: ${call.name}`);
          toolsCalled.push(call.name);
          collectedFunctionCalls.push(
            call as import('@google/genai').FunctionCall,
          );

          // Fire status update BEFORE executing each tool
          await context.onStatusUpdate?.({
            agentName: this.name,
            modelUsed: response.model,
            modelFallback: response.model !== this.defaultModel,
            toolsDone: toolsCalled.slice(0, -1), // Current tool is NOT done yet
            currentTool: call.name,
            currentToolDetail: getToolDetail(call.name, call.args as Record<string, unknown>),
            stepNumber: Math.min(toolsCalled.length, MAX_TOOL_CALLS),
            maxSteps: MAX_TOOL_CALLS,
            suspended: false,
          });

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

          // Fire status update AFTER suspension is detected
          await context.onStatusUpdate?.({
            agentName: this.name,
            modelUsed: response.model,
            modelFallback: response.model !== this.defaultModel,
            toolsDone: toolsCalled.slice(),
            currentTool: null,
            currentToolDetail: null,
            stepNumber: toolsCalled.length,
            maxSteps: MAX_TOOL_CALLS,
            suspended: true,
          });

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

      // Fallback for reaching max iterations: Request a final summary in Elena's voice
      this.logger.warn(
        `Agent [${this.name}] reached max iterations (${MAX_TOOL_CALLS}). Requesting final best-effort summary.`,
      );

      history.push({
        role: 'user',
        parts: [
          {
            text: `SYSTEM NOTICE: You have reached your tool execution limit. This is your FINAL turn. Summarize what you have gathered so far in your natural Elena persona (street-smart, witty, direct). Do NOT attempt to call any more tools. Do NOT explain that you hit a "limit" or a "system notice" unless Fred specifically asked about your mechanics. Just deliver your best findings as a teammate.`,
          },
        ],
      });

      const finalSummary = await this.geminiService.generateContent(
        this.defaultModel,
        history,
        { systemInstruction },
      );

      return {
        text:
          finalSummary.text ||
          "I've reached my execution limit and couldn't pin down a definitive answer. Let's try rephrasing or a different approach.",
        agentName: this.name,
        modelUsed: finalSummary.model,
        latencyMs: Date.now() - startTime,
        confidence: 50,
        toolsCalled,
        functionCalls:
          collectedFunctionCalls.length > 0
            ? collectedFunctionCalls
            : undefined,
      };
    } catch (error: unknown) {
      if (error instanceof ModelError) {
        // M-12: Catch non-transient errors (like PROHIBITED_CONTENT or 400 Bad Request) 
        // to gracefully degrade instead of crashing the Queue worker
        if (error.message.includes('PROHIBITED_CONTENT') || (error as any).status === 400) {
          const reason = error.message.includes('PROHIBITED_CONTENT') ? 'safety filters' : 'a formatting issue in my instructions';
          this.logger.warn(`Agent ${this.name} hit non-transient error: ${error.message}. Returning fallback message.`);
          return {
            text: `I'm sorry, I couldn't process that request due to ${reason}. Could we try rephrasing or taking a different approach?`,
            agentName: this.name,
            modelUsed: this.defaultModel,
            latencyMs: Date.now() - startTime,
            confidence: 0,
            toolsCalled,
          };
        }
      }

      this.logger.error(`Execution failed for ${this.name}: ${error}`);
      throw error;
    }
  }
}
