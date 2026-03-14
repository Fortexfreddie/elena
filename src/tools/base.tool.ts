import type { FunctionDeclaration } from '@google/genai';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { z } from 'zod';

export interface AgentTool {
    name: string;
    description: string;
    /** Optional Zod schema for runtime argument validation */
    argsSchema?: z.ZodObject<any>;
    /** If true, executor will suspend the run and require user HITL confirmation */
    requiresConfirmation: boolean;
    /** Returns the Gemini schema declaration for this tool */
    getDeclaration(): FunctionDeclaration;
    /** The actual logic to run when the AI calls this tool */
    execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult>;
}
