import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { PrismaService } from '@app/database';
import { ProfileBuilder } from '../personas/profile-builder.service';
import { OnboardingSessionStatus } from '@prisma/client';
import { z } from 'zod';

@Injectable()
export class ApproveUserTool implements AgentTool {
  private readonly logger = new Logger(ApproveUserTool.name);

  name = 'approve_user';
  description = 'Approve a pending user request to join the squad. Use this when a founder says "let them in" or "approve ofe".';
  requiresConfirmation = true;

  argsSchema = z.object({
    targetUserId: z
      .string()
      .describe('The Telegram ID or @username of the user to approve.'),
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileBuilder: ProfileBuilder,
  ) { }

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetUserId: {
            type: Type.STRING,
            description: 'The Telegram ID or @username of the user to approve.',
          },
        },
        required: ['targetUserId'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const targetUserId = args['targetUserId'] as string;
    const founderId = context.parsedMessage.userId;

    this.logger.log(`[APPROVAL_TRACE] Founder ${founderId} using tool to approve user ${targetUserId}`);

    try {
      // 1. Verify founder status
      const founder = await this.prisma.user.findUnique({
        where: { telegramId: founderId },
        select: { isFoundingMember: true, role: true },
      });

      if (!founder?.isFoundingMember && founder?.role !== 'superadmin' && founder?.role !== 'admin') {
        return {
          success: false,
          error: 'Only founders or admins can approve new members.',
        };
      }

      // 2. Find the target session. If targetUserId is a username, resolve it first.
      let actualTargetId = targetUserId;
      if (targetUserId.startsWith('@') || isNaN(Number(targetUserId))) {
        const cleanUsername = targetUserId.startsWith('@') ? targetUserId.slice(1) : targetUserId;
        const user = await this.prisma.user.findFirst({
          where: { username: { equals: cleanUsername, mode: 'insensitive' } },
          select: { telegramId: true },
        });
        if (!user) {
          return {
            success: false,
            error: `User with username @${cleanUsername} not found in my database. I need them to join the group and send me a message here in the group, while I'm active so I can index their Telegram ID before I can approve them.`,
          };
        }
        actualTargetId = user.telegramId;
      }

      // 3. Find the latest pending session for this user
      const session = await this.prisma.onboardingSession.findFirst({
        where: {
          telegramId: actualTargetId,
          status: OnboardingSessionStatus.pending_approval,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!session) {
        return {
          success: false,
          error: `No pending application found for user ${targetUserId}. They might already be approved or haven't finished the interview.`,
        };
      }


      // 3. Finalize profile
      await this.profileBuilder.finalize(session.id);

      return {
        success: true,
        data: `User ${targetUserId} has been successfully approved and added to the squad.`,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Approve user tool failed: ${msg}`);
      return {
        success: false,
        error: `Failed to approve user: ${msg}`,
      };
    }
  }
}
