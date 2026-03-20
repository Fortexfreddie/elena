import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { DmDispatcherService } from '../telegram/dm.dispatcher';
import { PrismaService } from '@app/database';

@Injectable()
export class SendDmTool implements AgentTool {
  private readonly logger = new Logger(SendDmTool.name);

  name = 'send_dm';
  description =
    'Deliver an administrative message or notification directly to a user\'s private chat. Use this for sensitive info, private confirmations, or when explicitly requested by an admin.';
  argsSchema = z.object({
    targetTelegramId: z.string(),
    text: z.string(),
  });

  requiresConfirmation = true;

  constructor(
    private readonly dmDispatcher: DmDispatcherService,
    private readonly prisma: PrismaService,
  ) {}

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
      // Security Check: Only admins and superadmins can send DMs through Elena
      const caller = await this.prisma.user.findUnique({
        where: { telegramId: context.parsedMessage.userId },
        select: { role: true },
      });

      if (!['superadmin', 'admin'].includes(caller?.role ?? '')) {
        return {
          success: false,
          error: 'Only admins and superadmins can send DMs through Elena.',
        };
      }

      // Resolve username to numeric ID if needed
      let actualTargetId = targetId;
      if (targetId.startsWith('@') || isNaN(Number(targetId))) {
        const cleanUsername = targetId.startsWith('@')
          ? targetId.slice(1)
          : targetId;
        const user = await this.prisma.user.findFirst({
          where: { username: { equals: cleanUsername, mode: 'insensitive' } },
          select: { telegramId: true },
        });

        if (!user) {
          return {
            success: false,
            error: `User with username @${cleanUsername} not found in my database. I need to have seen them in a group first to index their ID.`,
          };
        }
        actualTargetId = user.telegramId;
      }

      await this.dmDispatcher.sendDm(actualTargetId, text);
      return {
        success: true,
        data: { message: `DM sent to ${targetId} (ID: ${actualTargetId})` },
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
