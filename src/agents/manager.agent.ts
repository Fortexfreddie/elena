import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import type { AgentContext, AgentResponse } from '@app/common/types/agent.types';
import { CoderAgent } from './coder.agent';
import { ReviewerAgent } from './reviewer.agent';
import { ResearcherAgent } from './researcher.agent';
import { BrainstormAgent } from './brainstorm.agent';
import { TaskAgent } from './task.agent';

@Injectable()
export class ManagerAgent extends BaseAgent {
    constructor(
        geminiService: GeminiService,
        private readonly coderAgent: CoderAgent,
        private readonly reviewerAgent: ReviewerAgent,
        private readonly researcherAgent: ResearcherAgent,
        private readonly brainstormAgent: BrainstormAgent,
        private readonly taskAgent: TaskAgent
    ) {
        super('manager', GEMINI_MODELS.FLASH, geminiService);
    }

    protected getRoleInstruction(): string {
        return `You are Elena's Manager persona.
You are the primary interface for the user. When the user asks a conversational question, wants to chat, or asks to recall memory, you answer them directly using the provided chat history.
If the user asks for multi-step technical reasoning, code generation, extensive code review, deep research, or task management, you MUST use the 'delegate_task' tool to delegate to a specialist. Do not attempt complex coding or research tasks yourself.`;
    }

    protected getTools(): FunctionDeclaration[] {
        return [
            {
                name: 'delegate_task',
                description: 'Delegate a complex task to a specific specialist agent. Use this for coding, reviewing, researching, brainstorming, or task management.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        agent: {
                            type: Type.STRING,
                            description: 'The specialist agent to delegate to.',
                            enum: ['coder', 'reviewer', 'researcher', 'brainstorm', 'task']
                        },
                        reason: {
                            type: Type.STRING,
                            description: 'Brief reason for delegation.'
                        }
                    },
                    required: ['agent', 'reason']
                }
            }
        ];
    }

    /**
     * Executes the manager logic. If a direct route string was passed (bypassing manager reasoning), it delegates directly.
     * Otherwise it runs the Flash model and intercepts tool calls to execute specialists.
     */
    async execute(routeTo: string, context: AgentContext): Promise<AgentResponse> {
        this.logger.log(`Manager received execution request. Original Filter route decision: ${routeTo}`);

        // If the filter specifically requested a specialist, we bypass the Manager's reasoning to save tokens.
        if (routeTo !== 'manager' && ['coder', 'reviewer', 'researcher', 'brainstorm', 'task'].includes(routeTo)) {
            this.logger.log(`Bypassing Manager reasoning; directly executing delegate: ${routeTo}`);
            return this.invokeSpecialist(routeTo, context);
        }

        // Run the manager model dynamically
        const response = await this.run(context);

        // Check if Manager decided to delegate via tool call
        if (response.functionCalls && response.functionCalls.length > 0) {
            const call = response.functionCalls.find(fc => fc.name === 'delegate_task');
            if (call) {
                const agentName = (call.args?.['agent'] as string) ?? 'brainstorm';
                this.logger.log(`Manager agent decided to delegate to: ${agentName} (Reason: ${call.args?.['reason']})`);

                // Invoke the specialist with the original context
                return this.invokeSpecialist(agentName, context);
            }
        }

        // Return direct text response from Manager
        return response;
    }

    private async invokeSpecialist(agentName: string, context: AgentContext): Promise<AgentResponse> {
        switch (agentName) {
            case 'coder': return this.coderAgent.run(context);
            case 'reviewer': return this.reviewerAgent.run(context);
            case 'researcher': return this.researcherAgent.run(context);
            case 'brainstorm': return this.brainstormAgent.run(context);
            case 'task': return this.taskAgent.run(context);
            default: return this.brainstormAgent.run(context);
        }
    }
}
