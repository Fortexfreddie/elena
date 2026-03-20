import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { FunctionCall } from '@google/genai';
import { RegistryService } from './registry.service';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { TOOL_RESULT_MAX_CHARS } from '@app/common/gemini/gemini.constants';
import { UpstashRedisService, escapeHtml } from '@app/common';
import { ReplySenderService } from '../telegram/reply.sender';

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    private readonly registry: RegistryService,
    private readonly redisService: UpstashRedisService,
    @Inject(forwardRef(() => ReplySenderService))
    private readonly replySender: ReplySenderService,
  ) {}

  /**
   * Safely executes a function call requested by the LLM.
   * Prevents runtime crashes, applies truncation, and handles HITL routing.
   */
  async executeCall(
    call: FunctionCall,
    context: AgentContext,
  ): Promise<ToolResult> {
    const toolName = call.name;

    if (!toolName) {
      return { success: false, error: 'Function call missing name.' };
    }

    this.logger.log(`[TOOL_TRACE] Executing tool: ${toolName} with args: ${JSON.stringify(call.args)}`);
    const tool = this.registry.getTool(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' is not registered or supported.`,
      };
    }

    // Phase 4: HITL gate suspension logic
    if (tool.requiresConfirmation) {
      const nonce = randomBytes(6).toString('hex');
      const jobId = `${context.parsedMessage.chatId}:${nonce}`;
      const pendingActionKey = `hitl:${jobId}`;

      this.logger.warn(
        `HITL suspension triggered for ${toolName}. JobId: ${jobId}`,
      );

      // Serialize pending call to Redis
      // CRITICAL: Set<string> serializes as {} via JSON.stringify.
      // Convert to array so it survives the Redis round-trip.
      // MEDIUM #4: Strip mediaContent to preserve Redis bandwidth/prevent binary bloat
      const { mediaContent: _, ...contextWithoutMedia } = context;
      const pendingData = {
        toolName,
        args: call.args,
        requesterId: context.parsedMessage.userId, // Store the original requester for option B verification
        context: {
          ...contextWithoutMedia,
          parsedMessage: {
            ...context.parsedMessage,
            rawUpdate: undefined, // M-3: Strip raw Telegram update payload to prevent leaking sensitive info to Redis
          },
          decryptedSecretsSet: undefined, // Strip the Set (not JSON-safe)
          decryptedSecretsArray: Array.from(context.decryptedSecretsSet),
        },
      };

      await this.redisService.client.set(
        pendingActionKey,
        JSON.stringify(pendingData),
        { ex: 300 },
      );

      // Send proposal message to Telegram
      const argsSummary = Object.entries(call.args as any)
        .map(([k, v]) => `• <b>${k}</b>: <code>${escapeHtml(String(v))}</code>`)
        .join('\n');

      const proposal = `⚠️ <b>Action Proposed: ${toolName}</b>\n\nDetails:\n${argsSummary}\n\nTo execute this, reply with:\n<code>/confirm_${jobId}</code>\n\nTo cancel:\n<code>/cancel_${jobId}</code>`;

      await this.replySender.sendReply(
        context.parsedMessage.chatId,
        proposal,
        context.parsedMessage.rawUpdate.message?.message_id,
        'HTML',
        false, // Already manually escaped with escapeHtml
      );


      return {
        success: false,
        suspended: true,
        error: `Action '${toolName}' is suspended awaiting manual confirmation.`,
      };
    }

    try {
      // Zod validation if the tool provides a schema
      let validatedArgs = (call.args as Record<string, unknown>) ?? {};
      if (tool.argsSchema) {
        const parseResult = tool.argsSchema.safeParse(call.args);
        if (!parseResult.success) {
          this.logger.warn(
            `Argument validation failed for ${toolName}: ${parseResult.error.message}`,
          );
          return {
            success: false,
            error: `Invalid arguments for ${toolName}: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
          };
        }
        validatedArgs = parseResult.data;
      }

      const result = await tool.execute(validatedArgs, context);

      // Truncation logic (Prevent Gemini payload expansion limits)
      const serialized = JSON.stringify(result.data);
      if (serialized && serialized.length > TOOL_RESULT_MAX_CHARS) {
        const sizeKb = Math.round(serialized.length / 1024);
        this.logger.warn(`Truncated tool ${toolName} response (${sizeKb}kb)`);

        const truncatedData =
          serialized.slice(0, TOOL_RESULT_MAX_CHARS) +
          `\n\n[TRUNCATED: Full content is ${sizeKb}kb. Specify line range or filters to see more.]`;

        return {
          success: result.success,
          data: truncatedData,
          truncated: true,
        };
      }

      const serializedForLog = JSON.stringify(result.data);
      const logSnippet = serializedForLog && serializedForLog.length > 1000
        ? serializedForLog.slice(0, 1000) + '... [output too long for terminal]'
        : serializedForLog;

      this.logger.log(`[TOOL_TRACE] ${toolName} finished with success: ${result.success}. Result: ${logSnippet}`);

      return {
        ...result,
        terminateLoop: result.terminateLoop,
      };

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error thrown during tool ${toolName} execution: ${msg}`,
      );

      return {
        success: false,
        error: `Tool threw an exception: ${msg}`,
      };
    }
  }
}
