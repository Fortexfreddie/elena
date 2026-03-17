import { Injectable } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

/**
 * Tool for delegating tasks from Manager to specialists.
 * Returning terminateLoop: true signals the BaseAgent to stop its internal retry loop,
 * allowing the ManagerAgent to perform the handoff immediately.
 */
@Injectable()
export class DelegateTaskTool implements AgentTool {
  name = 'delegate_task';
  description =
    'Delegate a complex task to a specific specialist agent. Use this for coding, reviewing, researching, brainstorming, or task management.';
  requiresConfirmation = false;

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          agent: {
            type: Type.STRING,
            description: 'The specialist agent to delegate to.',
            enum: ['coder', 'reviewer', 'researcher', 'brainstorm', 'task'],
          },
          reason: {
            type: Type.STRING,
            description: 'Brief reason for delegation.',
          },
        },
        required: ['agent', 'reason'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const agent = args['agent'] as string;
    const reason = args['reason'] as string;

    return {
      success: true,
      data: {
        message: `Task delegation to '${agent}' initiated.`,
        reason,
      },
      terminateLoop: true, // CRITICAL: Stop the Manager's reasoning loop here.
    };
  }
}
