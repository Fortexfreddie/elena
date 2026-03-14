import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { FunctionCall } from '@google/genai';
import { RegistryService } from './registry.service';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { TOOL_RESULT_MAX_CHARS } from '@app/common/gemini/gemini.constants';
import { UpstashRedisService } from '@app/common';
import { ReplySenderService } from '../telegram/reply.sender';

@Injectable()
export class ExecutorService {
    private readonly logger = new Logger(ExecutorService.name);

    constructor(
        private readonly registry: RegistryService,
        private readonly redisService: UpstashRedisService,
        @Inject(forwardRef(() => ReplySenderService))
        private readonly replySender: ReplySenderService,
    ) { }

    /**
     * Safely executes a function call requested by the LLM.
     * Prevents runtime crashes, applies truncation, and handles HITL routing.
     */
    async executeCall(call: FunctionCall, context: AgentContext): Promise<ToolResult> {
        const toolName = call.name;

        if (!toolName) {
            return { success: false, error: 'Function call missing name.' };
        }

        this.logger.log(`Executing tool: ${toolName}`);
        const tool = this.registry.getTool(toolName);

        if (!tool) {
            return {
                success: false,
                error: `Tool '${toolName}' is not registered or supported.`
            };
        }

        // Phase 4: HITL gate suspension logic
        if (tool.requiresConfirmation) {
            // TODO: Replace with crypto.randomBytes(6).toString('hex') in Phase 5 for higher entropy
            const nonce = Math.random().toString(36).substring(2, 10);
            const jobId = `${context.parsedMessage.chatId}:${nonce}`;
            const pendingActionKey = `hitl:${jobId}`;

            this.logger.warn(`HITL suspension triggered for ${toolName}. JobId: ${jobId}`);

            // Serialize pending call to Redis
            // CRITICAL: Set<string> serializes as {} via JSON.stringify.
            // Convert to array so it survives the Redis round-trip.
            // MEDIUM #4: Strip mediaContent to preserve Redis bandwidth/prevent binary bloat
            const { mediaContent: _, ...contextWithoutMedia } = context;
            const pendingData = {
                toolName,
                args: call.args,
                context: {
                    ...contextWithoutMedia,
                    decryptedSecretsSet: undefined, // Strip the Set (not JSON-safe)
                    decryptedSecretsArray: Array.from(context.decryptedSecretsSet),
                },
            };

            await this.redisService.client.set(pendingActionKey, JSON.stringify(pendingData), { ex: 300 });

            // Send proposal message to Telegram
            const proposal = `⚠️ *Action Proposed: ${toolName}*\n\nArguments:\n\`\`\`json\n${JSON.stringify(call.args, null, 2)}\n\`\`\`\n\nTo execute this, reply with:\n\`/confirm_${jobId}\`\n\nTo cancel:\n\`/cancel_${jobId}\``;
            
            await this.replySender.sendReply(context.parsedMessage.chatId, proposal, context.parsedMessage.rawUpdate.message?.message_id);

            return {
                success: false,
                suspended: true,
                error: `Action '${toolName}' is suspended awaiting manual confirmation.`
            };
        }

        try {
            // Zod validation if the tool provides a schema
            let validatedArgs = call.args as Record<string, unknown> ?? {};
            if (tool.argsSchema) {
                const parseResult = tool.argsSchema.safeParse(call.args);
                if (!parseResult.success) {
                    this.logger.warn(`Argument validation failed for ${toolName}: ${parseResult.error.message}`);
                    return {
                        success: false,
                        error: `Invalid arguments for ${toolName}: ${parseResult.error.issues.map(i => i.message).join(', ')}`
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

                const truncatedData = serialized.slice(0, TOOL_RESULT_MAX_CHARS) + 
                    `\n\n[TRUNCATED: Full content is ${sizeKb}kb. Specify line range or filters to see more.]`;

                return {
                    success: result.success,
                    data: truncatedData,
                    truncated: true
                };
            }

            return {
                ...result,
                terminateLoop: result.terminateLoop
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error thrown during tool ${toolName} execution: ${msg}`);

            return {
                success: false,
                error: `Tool threw an exception: ${msg}`
            };
        }
    }
}
