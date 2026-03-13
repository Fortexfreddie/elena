import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import type { AgentTool } from './base.tool';
import type { ToolResult } from '@app/common/types/agent.types';

/**
 * Custom Web Research tool (Level 3 of Cascading Search).
 * Provides deep technical grounding when standard web search fails.
 * Designed to use Tavily API or similar under the hood.
 */
@Injectable()
export class CustomSearchTool implements AgentTool {
    private readonly logger = new Logger(CustomSearchTool.name);

    // Zod isn't strictly necessary for tool metadata, we just use the interface
    name = 'custom_web_research';
    description = 'Use this tool for deep technical research on developer docs, Github repos, or specific smart contracts. Do NOT use this for generic news or facts.';
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
                        description: 'The specific technical query or problem.',
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

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const query = args['query'] as string;
        const domains = args['domains'] as string[] | undefined;

        this.logger.log(`Executing custom_web_research for: ${query}`);

        try {
            // TODO-PHASE4: Implement actual Tavily API call here. 
            // For now, this is a stub simulating deep research.
            const resultData = {
                source: 'tavily_stub',
                query,
                domainsFiltered: domains ?? [],
                results: [
                    {
                        title: 'Technical Documentation Stub',
                        url: 'https://docs.example.com',
                        content: 'This is a mocked deep search result containing highly specific technical context.'
                    }
                ]
            };

            return {
                success: true,
                data: resultData
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`custom_web_research failed: ${msg}`);
            return {
                success: false,
                error: msg
            };
        }
    }
}
