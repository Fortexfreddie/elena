import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '@app/database';

@Injectable()
export class LogMonitorTool implements AgentTool {
  private readonly logger = new Logger(LogMonitorTool.name);

  name = 'log_monitor';
  description =
    'Read Elena\'s logs and audit trail. Use logType="raw" for Pino file logs, ' +
    'logType="audit" for structured Prisma AuditLog (recommended for agent/tool history), ' +
    'logType="both" to combine. Use minutesBack for time-based filtering (e.g. minutesBack=30 ' +
    'for last 30 minutes). Falls back to line-based if minutesBack not provided.';

  argsSchema = z.object({
    lines: z.number().optional(),
    minutesBack: z.number().optional(),
    logType: z.enum(['raw', 'audit', 'both']).optional(),
  });

  requiresConfirmation = false;

  constructor(private readonly prisma: PrismaService) {}

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
          minutesBack: {
            type: Type.NUMBER,
            description:
              'Filter logs from the last N minutes. When provided, overrides the lines parameter. Example: 30 = last 30 minutes of logs.',
          },
          logType: {
            type: Type.STRING,
            enum: ['raw', 'audit', 'both'],
            description:
              'raw = read from error.log file. audit = query Prisma AuditLog table. both = combine both sources. Defaults to raw.',
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
    const minutesBack = args['minutesBack'] as number | undefined;
    const logType = (args['logType'] as string) ?? 'raw';

    const results: string[] = [];

    // RAW FILE PATH
    if (logType === 'raw' || logType === 'both') {
      const logPath = process.env['LOG_FILE_PATH']
        ? path.resolve(process.env['LOG_FILE_PATH'])
        : path.join(process.cwd(), 'error.log');

      this.logger.log(
        `Executing log_monitor: reading from ${logPath} (minutesBack=${minutesBack ?? 'N/A'}, lines=${lines})`,
      );

      try {
        if (!fs.existsSync(logPath)) {
          results.push('No error.log found in working directory.');
        } else {
          const content = fs.readFileSync(logPath, 'utf8');
          const logLines = content.split('\n').filter((l) => l.trim().length > 0);

          let filtered: string[];

          if (minutesBack && minutesBack > 0) {
            // Time-based filtering — parse Pino JSON timestamps
            const cutoff = Date.now() - minutesBack * 60 * 1000;
            filtered = logLines.filter((line) => {
              try {
                const parsed = JSON.parse(line);
                return typeof parsed.time === 'number' && parsed.time >= cutoff;
              } catch {
                return false; // Skip non-JSON lines
              }
            });

            if (filtered.length === 0) {
              results.push(`No log entries found in the last ${minutesBack} minutes.`);
            }
          } else {
            // Line-based fallback
            filtered = logLines.slice(-Math.min(lines, 100));
          }

          let tail = filtered.join('\n');

          // Sanitize sensitive tokens
          tail = tail
            .replace(/bot[A-Za-z0-9_:]{20,}/g, 'bot[REDACTED]')
            .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
            .replace(/Bearer [A-Za-z0-9\-._~+\/]+=*/g, 'Bearer [REDACTED]')
            .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_GOOGLE_KEY]')
            .replace(/xai-[a-zA-Z0-9]{32,}/g, '[REDACTED_XAI_KEY]')
            .replace(/rediss?:\/\/[^\s"']+/g, '[REDACTED_REDIS_URL]')
            .replace(/postgres(ql)?:\/\/[^\s"']+/g, '[REDACTED_DB_URL]')
            .replace(/password[=:]\s*[^\s"',}]+/gi, 'password=[REDACTED]')
            .replace(/x-telegram-bot-api-secret-token["\s:]+[a-fA-F0-9]{20,}/gi, 'x-telegram-bot-api-secret-token: [REDACTED]');

          if (tail.length > 10000) {
            tail = tail.slice(-10000);
          }

          if (tail.trim().length > 0) {
            results.push(`=== RAW LOGS ===\n${tail}`);
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push(`Failed to read raw logs: ${msg}`);
      }
    }

    // AUDIT LOG PATH (Prisma AuditLog table)
    if (logType === 'audit' || logType === 'both') {
      try {
        const cutoffDate = minutesBack
          ? new Date(Date.now() - minutesBack * 60 * 1000)
          : new Date(Date.now() - 60 * 60 * 1000); // Default: last 1 hour

        const auditLogs = await this.prisma.auditLog.findMany({
          where: {
            createdAt: { gte: cutoffDate },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            actionType: true,
            agentName: true,
            modelUsed: true,
            toolCalled: true,
            sanitizedSummary: true,
            latencyMs: true,
            telegramId: true,
            createdAt: true,
          },
        });

        if (auditLogs.length === 0) {
          results.push(
            `No audit log entries found in the last ${minutesBack ?? 60} minutes.`,
          );
        } else {
          const formatted = auditLogs
            .map((log) => {
              const parts = [
                `[${log.createdAt.toISOString()}]`,
                `action=${log.actionType}`,
                log.agentName ? `agent=${log.agentName}` : null,
                log.modelUsed ? `model=${log.modelUsed}` : null,
                log.toolCalled ? `tools=${log.toolCalled}` : null,
                log.latencyMs ? `latency=${log.latencyMs}ms` : null,
                log.sanitizedSummary
                  ? `summary="${log.sanitizedSummary.slice(0, 100)}"`
                  : null,
              ]
                .filter(Boolean)
                .join(' | ');
              return parts;
            })
            .join('\n');

          results.push(`=== AUDIT LOGS (last ${minutesBack ?? 60} mins) ===\n${formatted}`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push(`Failed to query audit logs: ${msg}`);
      }
    }

    return {
      success: true,
      data: {
        logType,
        minutesBack: minutesBack ?? null,
        lines: minutesBack ? null : lines,
        content: results.join('\n\n') || 'No log data found.',
      },
    };
  }
}
