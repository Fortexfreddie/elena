import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

@Injectable()
export class RunCodeTool implements AgentTool {
  private readonly logger = new Logger(RunCodeTool.name);

  name = 'run_code';
  description =
    'Execute a block of code in a secure sandbox. Requires explicit user confirmation before running.';
  requiresConfirmation = true; // MUST REQUIRE CONFIRMATION

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          language: {
            type: Type.STRING,
            description:
              'The programming language (e.g., "typescript", "julia", "python").',
            enum: ['typescript', 'javascript', 'python', 'julia', 'solidity'],
          },
          code: {
            type: Type.STRING,
            description: 'The code to execute.',
          },
        },
        required: ['language', 'code'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const language = args['language'] as string;
    const code = args['code'] as string;

    this.logger.log(`Executing code in ${language}`);

    // Phase 4 Correction: run_code uses a simple confirmation gate.
    // The implementation here is a stub that returns a "success" simulation.
    // In real execution, the HITL controller handles the process.

    return {
      success: false,
      error: 'Code execution sandbox not yet implemented. Coming in Phase 5.',
    };
  }
}
