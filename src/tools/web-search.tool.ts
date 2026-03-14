import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

/**
 * Standard Web Search tool.
 * Alias/Wrapper for standard search (can be unified with custom search).
 */
@Injectable()
export class WebSearchTool implements AgentTool {
    private readonly logger = new Logger(WebSearchTool.name);

    name = 'web_search';
    description = 'Standard web search for facts, news, or general information.';
    requiresConfirmation = false;

    getDeclaration(): FunctionDeclaration {
        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: 'The search query.',
                    },
                    domains: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Optional array of domains to restrict search to (e.g. ["solana.com", "github.com"]).',
                    }
                },
                required: ['query'],
            },
        };
    }

    async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
        const query = args['query'] as string;
        const domains = args['domains'] as string[] | undefined;
        
        this.logger.log(`Executing web_search for: ${query} (Domains: ${domains?.join(', ') || 'none'})`);

        try {
            // Updated web search stub simulating domain filtering
            return {
                success: true,
                terminateLoop: true, // Signal to specialist: stop searching after this stub
                data: {
                    query,
                    results: [],
                    note: 'DEVELOPMENT MODE: Standard web search API not configured. No further results available. STOP SEARCHING.'
                }
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { success: false, error: msg };
        }
    }
}
