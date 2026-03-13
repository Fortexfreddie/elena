import { Logger } from '@nestjs/common';
import { GeminiService } from '@app/common/gemini/gemini.service';
import type { AgentContext, AgentResponse } from '@app/common/types/agent.types';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { GeminiModel } from '@app/common/gemini/gemini.constants';

export abstract class BaseAgent {
    protected readonly logger: Logger;

    constructor(
        protected readonly name: string,
        protected readonly defaultModel: GeminiModel,
        protected readonly geminiService: GeminiService
    ) {
        this.logger = new Logger(name);
    }

    /**
     * Each sub-agent must provide its specific role instructions.
     */
    protected abstract getRoleInstruction(): string;

    /**
     * Returns the array of function declarations this agent is allowed to use.
     */
    protected getTools(): FunctionDeclaration[] {
        return [];
    }

    /**
     * Combines agent-specific instructions with the global system block.
     */
    protected buildSystemInstruction(context: AgentContext): string {
        const parts = [
            this.getRoleInstruction(),
            context.systemBlock, // Global persona, rules, bounties, warm results
        ];
        return parts.filter(Boolean).join('\n\n---\n\n');
    }

    /**
     * Maps the hot memory context into Gemini's Content[] format.
     */
    protected formatHistory(context: AgentContext): Content[] {
        return context.assembledContext.hotMessages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
    }

    /**
     * The primary entry point for executing an agent's logic.
     * Future phase will add the tool execution loop here.
     */
    async run(context: AgentContext): Promise<AgentResponse> {
        const startTime = Date.now();
        const systemInstruction = this.buildSystemInstruction(context);
        const history = this.formatHistory(context);
        const tools = this.getTools();
        const toolsCalled: string[] = [];

        // Append the actual incoming message to the chat history
        const userMessageParts: any[] = [{ text: context.parsedMessage.text ?? '' }];

        if (context.mediaContent?.inlineData) {
            userMessageParts.push({ inlineData: context.mediaContent.inlineData });
        } else if (context.mediaContent?.fileUri) {
            userMessageParts.push({
                fileData: { 
                    fileUri: context.mediaContent.fileUri, 
                    mimeType: 'image/jpeg' // Simplified for now
                }
            });
        }

        history.push({ role: 'user', parts: userMessageParts });

        try {
            const response = await this.geminiService.generateContent(
                this.defaultModel,
                history,
                {
                    systemInstruction,
                    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
                }
            );

            // TODO-PHASE3: Implement tool calling executor loop here
            if (response.functionCalls?.length) {
                toolsCalled.push(...response.functionCalls.map(fc => fc.name));
            }

            const latencyMs = Date.now() - startTime;
            
            this.logger.log(`[EXECUTION_TRACE] Agent '${this.name}' completed in ${latencyMs}ms using model '${this.defaultModel}'. Tools called: ${toolsCalled.length > 0 ? toolsCalled.join(', ') : 'None'}`);

            return {
                text: response.text ?? '',
                agentName: this.name,
                modelUsed: this.defaultModel,
                latencyMs,
                confidence: 90, // To be implemented later
                toolsCalled,
                functionCalls: response.functionCalls
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Execution failed for ${this.name}: ${msg}`);
            throw error;
        }
    }
}
