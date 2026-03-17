import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
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
          data: 'Logs are currently empty. No error.log found in working directory.',
        };
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const logLines = content.split('\n');
      let tail = logLines.slice(-Math.min(lines, 100)).join('\n');

      // Sanitize sensitive tokens before returning to agent context
      tail = tail
        .replace(/bot[A-Za-z0-9_:]{20,}/g, 'bot[REDACTED]')
        .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
        .replace(/Bearer [A-Za-z0-9\-._~+\/]+=*/g, 'Bearer [REDACTED]');

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
