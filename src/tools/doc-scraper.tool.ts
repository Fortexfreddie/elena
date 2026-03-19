import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import got from 'got';

@Injectable()
export class DocScraperTool implements AgentTool {
  private readonly logger = new Logger(DocScraperTool.name);

  name = 'doc_scraper';
  description =
    'Extract Markdown-converted text from a URL. Use this for deep research grounding when you need to read documentation or technical blog posts.';
  requiresConfirmation = false;

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description: 'The URL to scrape and convert to markdown.',
          },
        },
        required: ['url'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const url = args['url'] as string;

    // URL Validation
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only HTTP/HTTPS URLs allowed.' };
      }
      const blocked = [
        'localhost',
        '127.0.0.1',
        '169.254.169.254',
        '0.0.0.0',
        '::1',
      ];
      if (blocked.some((b) => parsed.hostname.includes(b))) {
        return { success: false, error: 'Internal URLs not allowed.' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format.' };
    }

    this.logger.log(`Scraping URL via Jina: ${url}`);

    try {
      const response = await got.get(
        `https://r.jina.ai/${encodeURIComponent(url)}`,
        {
          timeout: { request: 15000 },
          headers: {
            'User-Agent': 'ElenaSquadBot/1.0 (Research Agent)',
            Accept: 'text/markdown',
            ...(process.env['JINA_API_KEY']
              ? { Authorization: `Bearer ${process.env['JINA_API_KEY']}` }
              : {}),
          },
        },
      );

      return {
        success: true,
        data: {
          url,
          content: response.body,
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scraping failed for ${url}: ${msg}`);
      return {
        success: false,
        error: `Scraping failed: ${msg}`,
      };
    }
  }
}
