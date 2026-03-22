import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { PrismaService } from '@app/database/database.service';
import { QueueService } from '../queue/queue.service';
import { UserGroupService } from '../telegram/user-group.service';

@Injectable()
export class SendReminderTool implements AgentTool {
  private readonly logger = new Logger(SendReminderTool.name);

  name = 'send_reminder';
  description = 'Schedule a reminder. Use targetType="dm" for personal reminders ("remind me"). Use targetType="group" ONLY when user explicitly says "remind the group" or "alert everyone". Default is "dm" when in doubt.';
  argsSchema = z.object({
    reminderText: z.string(),
    confirmationMessage: z.string(),
    minutesFromNow: z.number(),
    targetType: z.enum(['group', 'dm']).optional(),
    targetUserId: z.string().optional(),
  });

  requiresConfirmation = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
    @Inject(forwardRef(() => UserGroupService))
    private readonly userGroupService: UserGroupService,
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
              'Numeric Telegram user ID ONLY (e.g. "1416469884"). NEVER use display names, usernames, or @handles. Must be a number. Get the exact ID from the user profile in context. Only required when targetType is "dm".',
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
    const chatId = context.parsedMessage.chatId;

    let resolvedTargetType = targetType ?? 'group';
    let resolvedTargetChatId = chatId; // default to current chat

    if (isDm) {
      if (targetType === 'group') {
        // User in DM wants reminder sent to their group
        // Look up their most recent group
        const userProfile = context.assembledContext.userProfile;
        if (userProfile) {
          const recentGroup = await this.userGroupService.getMostRecentGroup(
            userProfile.id,
          );
          if (recentGroup) {
            resolvedTargetType = 'group';
            resolvedTargetChatId = recentGroup.chatId;
            this.logger.log(
              `[REMINDER] DM→Group: resolved to chatId ${recentGroup.chatId}`,
            );
          } else {
            // No known groups — fall back to DM
            resolvedTargetType = 'dm';
            resolvedTargetChatId = requesterTelegramId;
            this.logger.warn(
              `[REMINDER] DM→Group requested but no known groups for user ${userProfile.id}. Falling back to DM.`,
            );
          }
        } else {
          resolvedTargetType = 'dm';
          resolvedTargetChatId = requesterTelegramId;
        }
      } else {
        // DM reminder to self
        resolvedTargetType = 'dm';
        resolvedTargetChatId = requesterTelegramId;
      }
    }

    // Validate targetUserId if dm with explicit targetUserId
    const resolvedTargetUserId =
      resolvedTargetType === 'dm' && targetUserId
        ? targetUserId
        : resolvedTargetType === 'dm'
        ? requesterTelegramId
        : null;

    const userId = context.assembledContext.userProfile?.id;

    if (!userId) return { success: false, error: 'User not found.' };

    if (!mins || mins <= 0 || mins > 525600) {
      return {
        success: false,
        error: 'minutesFromNow must be between 1 and 525600 (1 year max)',
      };
    }

    if (resolvedTargetType === 'dm' && resolvedTargetUserId) {
      if (isNaN(Number(resolvedTargetUserId))) {
        return {
          success: false,
          error: `targetUserId must be a numeric Telegram ID, not a display name or username. Received: "${resolvedTargetUserId}". Use the exact numeric Telegram ID from the user profile in context.`,
        };
      }
    }

    this.logger.log(`Scheduling reminder for user ${userId} in ${mins} mins`);

    try {
      const scheduledFor = new Date(Date.now() + mins * 60000);

      const reminder = await this.prisma.reminder.create({
        data: {
          userId,
          chatId: resolvedTargetChatId,
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
