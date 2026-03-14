import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { WarmMemoryService } from '../memory/warm.memory.service';

@Injectable()
export class MemorySearchTool implements AgentTool {
    private readonly logger = new Logger(MemorySearchTool.name);

    name = 'memory_search';
    description = 'Search through Elena\'s "Warm Memory" (previously discussed technical topics, project context, and user-specific knowledge) using semantic search. Use this when the direct chat history is insufficient.';
    requiresConfirmation = false;

    constructor(private readonly warmMemory: WarmMemoryService) { }

    getDeclaration(): FunctionDeclaration {
        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: 'The semantic query to search for in memory.',
                    }
                },
                required: ['query'],
            },
        };
    }

    async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
        const query = args['query'] as string;
        const userId = context.parsedMessage.userId;

        this.logger.log(`Executing memory_search for user ${userId}: ${query}`);

        try {
            const results = await this.warmMemory.search(query, userId);
            
            if (results.length === 0) {
                return {
                    success: true,
                    data: 'No relevant memories found for this query.'
                };
            }

            return {
                success: true,
                data: results.map(r => ({
                    text: r.text,
                    score: r.score,
                    metadata: r.metadata
                }))
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Memory search tool failed: ${msg}`);
            return {
                success: false,
                error: `Memory search failed: ${msg}`
            };
        }
    }
}
