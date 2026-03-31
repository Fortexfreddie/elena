import { Injectable } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { SaveInterviewArgsSchema } from '@app/common/types/agent.types';
import type { AgentTool } from './base.tool';

@Injectable()
export class SaveInterviewTool implements AgentTool {
  name = 'save_interview';
  description = 'Save the completed interview data to be reviewed by founders.';
  argsSchema = SaveInterviewArgsSchema;
  requiresConfirmation = false;

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          displayName: {
            type: Type.STRING,
            description: 'The preferred name of the user.',
          },
          role: {
            type: Type.STRING,
            description: 'The role or expertise of the user.',
          },
          technicalTone: {
            type: Type.STRING,
            description: 'Preferred tone for technical discussions.',
          },
          summary: {
            type: Type.STRING,
            description: 'A brief summary of the user and why they are joining.',
          },
          timezone: {
            type: Type.STRING,
            description: 'The timezone of the user if provided (e.g. UTC, EST, Africa/Lagos).',
          },
        },
        required: ['displayName', 'role', 'technicalTone', 'summary'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<ToolResult> {
    // The actual saving logic is handled by InterviewerService which intercepts this call.
    // This tool exists to satisfy the ExecutorService and return a success signal to the model.
    return {
      success: true,
      data: {
        message: 'Interview data logged successfully. The system will now finalize the profile.',
      },
    };
  }
}
