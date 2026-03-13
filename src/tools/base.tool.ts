import type { FunctionDeclaration } from '@google/genai';
import type { ToolResult } from '@app/common/types/agent.types';

export interface AgentTool {
    name: string;
    description: string;
    /** If true, executor will suspend the run and require user HITL confirmation */
    requiresConfirmation: boolean;
    /** Returns the Gemini schema declaration for this tool */
    getDeclaration(): FunctionDeclaration;
    /** The actual logic to run when the AI calls this tool */
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}
