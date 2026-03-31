import { Injectable, Logger } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { UpdateUserPreferencesArgsSchema } from '@app/common/types/agent.types';
import type { AgentTool } from './base.tool';
import { PrismaService } from '@app/database';
import { UserRole, Prisma } from '@prisma/client';

@Injectable()
export class UpdateUserPreferencesTool implements AgentTool {
  private readonly logger = new Logger(UpdateUserPreferencesTool.name);
  name = 'update_user_preferences';
  description = 'Update a user\'s communication preferences (tone, language, timezone, DMs). This is strictly for interaction rules. Personal details like summary/skills go to update_user_profile.';
  argsSchema = UpdateUserPreferencesArgsSchema;
  requiresConfirmation = true;

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
            description: 'The Telegram ID or @username of the user to update (leave blank to update your own).',
          },
          technicalTone: {
            type: Type.STRING,
            description: 'Preferred tone for technical discussions (e.g. "highly technical", "simple words", "strict focus").',
          },
          preferredLanguage: {
            type: Type.STRING,
            description: 'Preferred spoken language for casual or technical conversation (e.g. "English", "Igbo", "Pidgin").',
          },
          verbosityLevel: {
            type: Type.STRING,
            description: 'How concise or detailed the responses should be.',
          },
          allowProactiveDms: {
            type: Type.BOOLEAN,
            description: 'Can Elena initiate messages contextually?',
          },
          timezone: {
            type: Type.STRING,
            description: 'User\'s timezone if provided.',
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
    const technicalTone = args['technicalTone'] as string | undefined;
    const preferredLanguage = args['preferredLanguage'] as string | undefined;
    const verbosityLevel = args['verbosityLevel'] as string | undefined;
    const allowProactiveDms = args['allowProactiveDms'] as boolean | undefined;
    const timezone = args['timezone'] as string | undefined;
    const requester = context.assembledContext.userProfile;

    if (!requester) {
      return { success: false, error: 'Requester profile not found.' };
    }

    const targetUserId = (args['targetUserId'] as string | undefined) || requester.telegramId;

    // 1. Fetch target user
    let targetUser = await this.prisma.user.findUnique({
      where: { telegramId: targetUserId },
    });

    // If not found, try lookup by username
    if (!targetUser) {
      const cleanUsername = targetUserId.startsWith('@') ? targetUserId.slice(1) : targetUserId;
      targetUser = await this.prisma.user.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } },
      });
    }

    if (!targetUser) {
      return { success: false, error: `User with ID or Username ${targetUserId} not found.` };
    }

    const actualTargetId = targetUser.telegramId;

    // 2. Security Checks
    // 2. Security Checks
    const isSelfUpdate = requester.telegramId === actualTargetId;

    if (!isSelfUpdate) {
      return { success: false, error: 'Permission denied. Personal preferences can only be updated by the individual user.' };
    }

    // 3. Update data construction
    const updateData: Prisma.UserUpdateInput = {};
    
    // We extract existing preferencesJson to merge it properly
    const existingPrefs = (targetUser.preferencesJson as Record<string, any>) || {};
    const newPrefs = { ...existingPrefs };

    if (technicalTone !== undefined) newPrefs.technicalTone = technicalTone;
    if (preferredLanguage !== undefined) newPrefs.preferredLanguage = preferredLanguage;
    if (verbosityLevel !== undefined) newPrefs.verbosityLevel = verbosityLevel;
    if (allowProactiveDms !== undefined) newPrefs.allowProactiveDms = allowProactiveDms;
    if (timezone !== undefined) newPrefs.timezone = timezone;

    updateData.preferencesJson = newPrefs;

    try {
      const updated = await this.prisma.user.update({
        where: { telegramId: actualTargetId },
        data: updateData,
      });

      this.logger.log(`Preferences updated for ${updated.displayName} by ${requester.displayName}`);

      return {
        success: true,
        data: {
          message: `Successfully updated preferences for ${updated.displayName}.`,
          user: {
            id: updated.id,
            displayName: updated.displayName,
            preferences: updated.preferencesJson,
          },
        },
      };
    } catch (err: any) {
      this.logger.error(`Failed to update user preferences ${targetUserId}`, err);
      return { success: false, error: `Database error: ${err.message}` };
    }
  }
}
