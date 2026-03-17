import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { DmDispatcherService } from '../telegram/dm.dispatcher';

@Injectable()
export class SendDmTool implements AgentTool {
  private readonly logger = new Logger(SendDmTool.name);

  name = 'send_dm';
  description =
    'Send a private direct message to a user. Use this for sensitive info, private confirmations, or when explicitly asked to DM.';
  requiresConfirmation = false;

  constructor(private readonly dmDispatcher: DmDispatcherService) {}

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetTelegramId: {
            type: Type.STRING,
            description: 'The Telegram user ID to send the DM to.',
          },
          text: {
            type: Type.STRING,
            description: 'The message text.',
          },
        },
        required: ['targetTelegramId', 'text'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const targetId = args['targetTelegramId'] as string;
    const text = args['text'] as string;

    this.logger.log(`Executing send_dm to ${targetId}`);

    try {
      await this.dmDispatcher.sendDm(targetId, text);
      return {
        success: true,
        data: { message: `DM sent to ${targetId}` },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Send DM tool failed: ${msg}`);
      return {
        success: false,
        error: `Failed to send DM: ${msg}`,
      };
    }
  }
}
