import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Langfuse } from 'langfuse';
import { MaskerService } from '../safety/masker.service';

export interface LangfuseTraceInput {
  jobId: string;
  userId: string;
  chatId: string;
  agentName: string;
  modelUsed: string;
  inputText: string;
  outputText: string;
  toolsCalled: string[];
  latencyMs: number;
}

@Injectable()
export class LangfuseService implements OnModuleDestroy {
  private readonly logger = new Logger(LangfuseService.name);
  private readonly client: Langfuse | null = null;
  private readonly enabled: boolean;

  constructor(private readonly masker: MaskerService) {
    const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
    const secretKey = process.env['LANGFUSE_SECRET_KEY'];
    const baseUrl = process.env['LANGFUSE_BASE_URL'] ?? 'https://cloud.langfuse.com';

    if (publicKey && secretKey) {
      this.client = new Langfuse({
        publicKey,
        secretKey,
        baseUrl,
        flushAt: 10,       // Batch up to 10 events before flushing
        flushInterval: 5000, // Flush every 5 seconds
      });
      this.enabled = true;
      this.logger.log('[LANGFUSE] Langfuse tracing enabled');
    } else {
      this.enabled = false;
      this.logger.warn('[LANGFUSE] Langfuse keys not set — tracing disabled');
    }
  }

  /**
   * Send a trace to Langfuse.
   * ALWAYS masks input/output before sending — secrets never leave Elena.
   * Non-fatal — if Langfuse is down, pipeline continues.
   */
  async trace(input: LangfuseTraceInput): Promise<string | null> {
    if (!this.enabled || !this.client) return null;

    try {
      // CRITICAL: Mask before sending to external service
      const maskedInput = this.masker.mask(input.inputText);
      const maskedOutput = this.masker.mask(input.outputText);

      const trace = this.client.trace({
        id: input.jobId,
        name: `elena-${input.agentName}`,
        userId: input.userId,
        metadata: {
          chatId: input.chatId,
          agentName: input.agentName,
          modelUsed: input.modelUsed,
          toolsCalled: input.toolsCalled,
          latencyMs: input.latencyMs,
        },
        input: maskedInput,
        output: maskedOutput,
      });

      // Log the generation span
      trace.generation({
        name: `${input.agentName}-generation`,
        model: input.modelUsed,
        input: maskedInput,
        output: maskedOutput,
        usage: {
          unit: 'TOKENS',
        },
        metadata: {
          toolsCalled: input.toolsCalled,
          latencyMs: input.latencyMs,
        },
      });

      return trace.id;
    } catch (error: unknown) {
      // NEVER throw — Langfuse must not crash the pipeline
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[LANGFUSE] Trace failed (non-fatal): ${msg}`);
      return null;
    }
  }

  /**
   * Flush pending traces on shutdown.
   * Required: Langfuse batches events — must flush before process exits.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdownAsync();
        this.logger.log('[LANGFUSE] Flushed pending traces on shutdown');
      } catch (err) {
        this.logger.warn('[LANGFUSE] Failed to flush on shutdown', err);
      }
    }
  }
}
