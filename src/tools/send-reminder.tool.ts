import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { PrismaService } from '@app/database/database.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class SendReminderTool implements AgentTool {
  private readonly logger = new Logger(SendReminderTool.name);

  name = 'send_reminder';
  description = 'Schedule a reminder. In DM conversations always use targetType="dm" and set targetUserId to the requester telegram ID from context. In group conversations use targetType="group".';
  requiresConfirmation = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
  ) { }

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          reminderText: {
            type: Type.STRING,
            description: 'The text of the reminder.',
          },
          confirmationMessage: {
            type: Type.STRING,
            description:
              'The message to show the user now confirming it was set.',
          },
          minutesFromNow: {
            type: Type.NUMBER,
            description: 'How many minutes from now to send the reminder.',
          },
          targetType: {
            type: Type.STRING,
            enum: ['group', 'dm'],
            description:
              'Where to send the reminder. group = current chat, dm = private DM to a user.',
          },
          targetUserId: {
            type: Type.STRING,
            description:
              'Telegram user ID to DM (required when targetType is dm).',
          },
        },
        required: ['reminderText', 'minutesFromNow', 'confirmationMessage'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const text = args['reminderText'] as string;
    const conf = args['confirmationMessage'] as string;
    const mins = args['minutesFromNow'] as number;
    const targetType = (args['targetType'] as string) ?? 'group';
    const targetUserId = args['targetUserId'] as string | undefined;

    const isDm = context.parsedMessage.isDm;
    const requesterTelegramId = context.parsedMessage.userId;

    const userId = context.assembledContext.userProfile?.id;
    const chatId = context.parsedMessage.chatId;

    if (!userId) return { success: false, error: 'User not found.' };

    if (!mins || mins <= 0 || mins > 525600) {
      return {
        success: false,
        error: 'minutesFromNow must be between 1 and 525600 (1 year max)',
      };
    }

    this.logger.log(`Scheduling reminder for user ${userId} in ${mins} mins`);

    try {
      const scheduledFor = new Date(Date.now() + mins * 60000);

      const resolvedTargetType = isDm ? 'dm' : (targetType ?? 'group');
      const resolvedTargetUserId = isDm
        ? requesterTelegramId
        : (targetUserId ?? null);

      const reminder = await this.prisma.reminder.create({
        data: {
          userId,
          chatId:
            resolvedTargetType === 'dm' && resolvedTargetUserId
              ? resolvedTargetUserId
              : chatId,
          reminderMessage: text,
          confirmationMessage: conf,
          scheduledFor,
          targetType: resolvedTargetType,
          targetUserId: resolvedTargetUserId,
        },
      });

      await this.queue.addReminderJob(reminder.id, mins * 60000);

      return {
        success: true,
        data: {
          message: conf,
          scheduledAt: scheduledFor.toISOString(),
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Send reminder tool failed: ${msg}`);
      return {
        success: false,
        error: `Failed to schedule reminder: ${msg}`,
      };
    }
  }
}
