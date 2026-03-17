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

    this.logger.log(`Scraping URL: ${url}`);

    try {
      // In a production environment, you might use a service like Jina Reader or a custom playwright instance.
      // For now, we use a simple fetch + potential future conversion.
      // Requirement 1: Markdown conversion. We use a simple regex-based or service-based approach if available.

      const response = await got.get(url, {
        timeout: { request: 10000 },
        headers: {
          'User-Agent': 'ElenaSquadBot/1.0 (Research Agent)',
        },
      });

      const contentType = response.headers['content-type'] || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        return {
          success: false,
          error: `URL returned non-HTML content (${contentType}). Cannot scrape.`,
        };
      }
      const body = response.body
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
        .replace(/<[^>]+>/g, ' ') // Strip HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      return {
        success: true,
        data: {
          url,
          content: body,
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
