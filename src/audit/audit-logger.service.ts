import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { SanitizerService } from '../safety/sanitizer.service';

export interface AuditLogInput {
  actionType: string;
  telegramId?: string;
  jobId?: string;
  agentName?: string;
  modelUsed?: string;
  toolCalled?: string;
  sanitizedSummary?: string;
  latencyMs?: number;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizer: SanitizerService,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      // Sanitize summary — regex layer only, no secrets set needed here
      const rawSummary = input.sanitizedSummary ?? null;
      const sanitized = rawSummary
        ? this.sanitizer.sanitize(rawSummary, new Set()).slice(0, 500)
        : null;

      await this.prisma.auditLog.create({
        data: {
          actionType: input.actionType,
          telegramId: input.telegramId ?? null,
          jobId: input.jobId ?? null,
          agentName: input.agentName ?? null,
          modelUsed: input.modelUsed ?? null,
          toolCalled: input.toolCalled ?? null,
          sanitizedSummary: sanitized,
          latencyMs: input.latencyMs ?? null,
        },
      });
    } catch (error: unknown) {
      // NEVER throw — audit logging must not crash the pipeline
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[AUDIT] Failed to write audit log: ${msg}`);
    }
  }
}
