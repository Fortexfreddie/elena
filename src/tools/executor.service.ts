import { Injectable, Logger } from '@nestjs/common';
import type { FunctionCall } from '@google/genai';
import { RegistryService } from './registry.service.js';
import type { ToolResult } from '@app/common/types/agent.types';
import { TOOL_RESULT_MAX_CHARS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class ExecutorService {
    private readonly logger = new Logger(ExecutorService.name);

    constructor(private readonly registry: RegistryService) {}

    /**
     * Safely executes a function call requested by the LLM.
     * Prevents runtime crashes, applies truncation, and handles HITL routing (future).
     */
    async executeCall(call: FunctionCall): Promise<ToolResult> {
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

        if (tool.requiresConfirmation) {
            // TODO-PHASE5: Suspend execution, save state to Redis, wait for user `/confirm` via Telegram
            this.logger.warn(`HITL confirmation required for tool: ${toolName}. Logic will be implemented in Phase 5.`);
            return {
                success: false,
                error: `Tool '${toolName}' requires user confirmation. Execution suspended.`
            };
        }

        try {
            const result = await tool.execute(call.args as Record<string, unknown> ?? {});
            
            // Truncation logic (Prevent Gemini payload expansion limits)
            const serialized = JSON.stringify(result.data);
            if (serialized && serialized.length > TOOL_RESULT_MAX_CHARS) {
                this.logger.warn(`Truncating response from tool ${toolName} (length: ${serialized.length})`);
                
                const truncatedData = serialized.slice(0, TOOL_RESULT_MAX_CHARS) + '\n\n...[TRUNCATED_DUE_TO_SIZE]...';
                
                return {
                    success: result.success,
                    data: truncatedData,
                    truncated: true,
                    truncationNote: `Result was truncated. Original size: ${serialized.length} chars.`
                };
            }

            return result;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error thrown during tool ${toolName} execution: ${msg}`);
            
            // Never throw back to the LLM agent — always return the error as text so it can self-correct.
            return {
                success: false,
                error: `Tool threw an exception: ${msg}`
            };
        }
    }
}
