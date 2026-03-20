import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LogMonitorTool implements AgentTool {
  private readonly logger = new Logger(LogMonitorTool.name);

  name = 'log_monitor';
  description =
    'Read recent raw system logs (last 50-100 lines) from error.log. CRITICAL: Do NOT hallucinate or summarize logs in a "cool AI" way. You MUST report the raw [TOOL_TRACE] or [AGENT_TRACE] entries exactly as they appear in the file to provide evidence of your actions.';


  argsSchema = z.object({
    lines: z.number().optional(),
  });

  requiresConfirmation = false;

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          lines: {
            type: Type.NUMBER,
            description:
              'Number of lines to retrieve (max 100). Defaults to 50.',
          },
        },
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const lines = (args['lines'] as number) ?? 50;
    const logPath = path.join(process.cwd(), 'error.log');

    this.logger.log(
      `Executing log_monitor: reading ${lines} lines from ${logPath}`,
    );

    try {
      if (!fs.existsSync(logPath)) {
        return {
          success: true,
          data: "No error.log found. In production, logs are sent to stdout/stderr (Cloud Run) and are not written to file. Use the cloud provider's logging console instead.",
        };
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const logLines = content.split('\n');
      let tail = logLines.slice(-Math.min(lines, 100)).join('\n');

      // Sanitize sensitive tokens before returning to agent context
      tail = tail
        .replace(/bot[A-Za-z0-9_:]{20,}/g, 'bot[REDACTED]')
        .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
        .replace(/Bearer [A-Za-z0-9\-._~+\/]+=*/g, 'Bearer [REDACTED]')
        .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_GOOGLE_KEY]')
        .replace(/xai-[a-zA-Z0-9]{32,}/g, '[REDACTED_XAI_KEY]')
        .replace(/rediss?:\/\/[^\s"']+/g, '[REDACTED_REDIS_URL]')
        .replace(/postgres(ql)?:\/\/[^\s"']+/g, '[REDACTED_DB_URL]')
        .replace(/password[=:]\s*[^\s"',}]+/gi, 'password=[REDACTED]');

      if (tail.length > 10000) {
        tail = tail.slice(-10000);
      }

      return {
        success: true,
        data: {
          file: 'error.log',
          content: tail || 'File exists but is empty.',
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Log monitor failed: ${msg}`);
      return {
        success: false,
        error: `Failed to read logs: ${msg}`,
      };
    }
  }
}
