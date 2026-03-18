import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import got from 'got';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

/**
 * Standard Web Search tool using Serper.dev API.
 */
@Injectable()
export class WebSearchTool implements AgentTool {
  private readonly logger = new Logger(WebSearchTool.name);

  name = 'web_search';
  description = 'Standard web search for facts, news, or general information.';
  requiresConfirmation = false;

  constructor(private readonly config: ConfigService) {}

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
            description:
              'Optional array of domains to restrict search to (e.g. ["solana.com", "github.com"]).',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const query = args['query'] as string;
    const domains = args['domains'] as string[] | undefined;
    const apiKey = this.config.get<string>('SERPER_API_KEY');

    if (!apiKey) {
      return { success: false, error: 'SERPER_API_KEY not configured.' };
    }

    const payload: any = { q: query, num: 10 };
    if (domains && domains.length > 0) {
      payload.q = `${query} site:${domains[0]}`;
    }

    this.logger.log(
      `Executing web_search for: ${query} (Domains: ${domains?.join(', ') || 'none'})`,
    );

    try {
      const response = await got.post('https://google.serper.dev/search', {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        json: payload,
        responseType: 'json',
      });

      const data = response.body as any;
      const results = (data.organic ?? []).slice(0, 8).map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
      }));

      if (results.length === 0) {
        return {
          success: true,
          data: { query, results: [], note: 'No results found.' },
        };
      }

      return { success: true, data: { query, results } };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Web search tool failed: ${msg}`);
      return { success: false, error: msg };
    }
  }
}
