import { Injectable, Logger } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import type { AgentTool } from './base.tool';
import { PrismaService } from '@app/database';

@Injectable()
export class ViewUserProfileTool implements AgentTool {
  private readonly logger = new Logger(ViewUserProfileTool.name);
  name = 'view_user_profile';
  description = 'View a user\'s profile (role, persona, summary) and preferences (timezone, DM rules, tone). Use this BEFORE updating a user profile to avoid overwriting existing data.';
  requiresConfirmation = false;

  constructor(private readonly prisma: PrismaService) {}

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetUserId: {
            type: Type.STRING,
            description: 'The Telegram ID or @username of the user to view (e.g. @Kamzy123). Leave blank to view your own.',
          },
        },
        required: [],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const requester = context.assembledContext.userProfile;
    if (!requester) {
      return { success: false, error: 'Requester profile not found.' };
    }

    const targetUserId = (args['targetUserId'] as string | undefined) || requester.telegramId;

    let targetUser = await this.prisma.user.findUnique({
      where: { telegramId: targetUserId },
      select: { telegramId: true, username: true, displayName: true, role: true, personaJson: true, preferencesJson: true, onboardingStatus: true }
    });

    if (!targetUser) {
      const cleanUsername = targetUserId.startsWith('@') ? targetUserId.slice(1) : targetUserId;
      targetUser = await this.prisma.user.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } },
        select: { telegramId: true, username: true, displayName: true, role: true, personaJson: true, preferencesJson: true, onboardingStatus: true }
      });
    }

    if (!targetUser) {
      return { success: false, error: `User with ID or Username ${targetUserId} not found.` };
    }

    return {
      success: true,
      data: targetUser
    };
  }
}
