import { Injectable, Logger } from '@nestjs/common';
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import type { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { UpdateUserProfileArgsSchema } from '@app/common/types/agent.types';
import type { AgentTool } from './base.tool';
import { PrismaService } from '@app/database';
import { OnboardingStatus, UserRole, Prisma } from '@prisma/client';

@Injectable()
export class UpdateUserProfileTool implements AgentTool {
  private readonly logger = new Logger(UpdateUserProfileTool.name);
  name = 'update_user_profile';
  description = 'Update a user\'s core identity Profile (role, name, summary, skills). DO NOT use this for communication preferences or behavior rules. ALWAYS use view_user_profile to read the existing summary before updating it to avoid accidental deletion.';
  argsSchema = UpdateUserProfileArgsSchema;
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
            description: 'The Telegram ID or @username of the user to update (leave blank for self).',
          },
          displayName: { type: Type.STRING },
          role: {
            type: Type.STRING,
            enum: ['superadmin', 'admin', 'member', 'guest'],
          },
          personaSummary: { 
            type: Type.STRING,
            description: 'Target user\'s profile summary. ONLY include this if you are actively changing it. Do NOT copy existing data into here.'
          },
          coreSkills: {
            type: Type.STRING,
            description: 'A comma-separated list of the user\'s core skills or stacks.',
          },
          pronouns: {
            type: Type.STRING,
            description: 'User\'s pronouns (e.g. they/them, she/her).',
          },
          actionJustification: {
            type: Type.STRING,
            description: 'A brief explanation of why you are taking this action. Will be shown to the admin.',
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
    const targetUserId = args['targetUserId'] as string | undefined;
    const displayName = args['displayName'] as string | undefined;
    const role = args['role'] as string | undefined;
    const personaSummary = args['personaSummary'] as string | undefined;
    const coreSkills = args['coreSkills'] as string | undefined;
    const pronouns = args['pronouns'] as string | undefined;
    const requester = context.assembledContext.userProfile;

    if (!requester) {
      return { success: false, error: 'Requester profile not found.' };
    }

    const safeTargetUserId = targetUserId || requester.telegramId;

    // 1. Fetch target user
    let targetUser = await this.prisma.user.findUnique({
      where: { telegramId: safeTargetUserId },
    });

    // If not found, try lookup by username (handle @ prefix)
    if (!targetUser) {
      const cleanUsername = safeTargetUserId.startsWith('@') ? safeTargetUserId.slice(1) : safeTargetUserId;
      targetUser = await this.prisma.user.findFirst({
        where: { username: { equals: cleanUsername, mode: 'insensitive' } },
      });
    }

    if (!targetUser) {
      return { success: false, error: `User with ID or Username ${safeTargetUserId} not found.` };
    }

    // Update targetUserId to the actual numeric ID for the rest of the logic
    const actualTargetId = targetUser.telegramId;


    // 2. Security Checks
    const isRequesterSuper = requester.role === UserRole.superadmin;
    const isRequesterAdmin = requester.role === UserRole.admin;
    const isSelfUpdate = requester.telegramId === actualTargetId;

    // Rule: Admins cannot update Superadmins at all
    if (isRequesterAdmin && targetUser.role === UserRole.superadmin) {
      if (!isSelfUpdate) {
        return { success: false, error: 'Permission denied. Admins cannot modify or demote the Superadmin (Creator).' };
      }
    }

    // Rule: Non-admins can only update their own profile
    if (!isRequesterSuper && !isRequesterAdmin && !isSelfUpdate) {
      return { success: false, error: 'Permission denied. You can only update your own profile.' };
    }

    if (!isRequesterSuper && !isRequesterAdmin && isSelfUpdate) {
      if (role) {
        return { success: false, error: 'Permission denied. You cannot update your own role.' };
      }
    }

    // Rule: NO ONE can update personal identity features of other users
    if (!isSelfUpdate) {
      const existingPersona = (targetUser.personaJson as Record<string, any>) || {};
      
      const isChangingSummary = personaSummary !== undefined && personaSummary.trim() !== String(existingPersona.summary || '').trim();
      const isChangingSkills = coreSkills !== undefined && coreSkills.trim() !== String(existingPersona.coreSkills || '').trim();
      const isChangingPronouns = pronouns !== undefined && pronouns.trim() !== String(existingPersona.pronouns || '').trim();
      
      if (isChangingSummary || isChangingSkills || isChangingPronouns) {
        return { success: false, error: 'Permission denied. Personal details (summary, skills, pronouns) can only be updated by the individual user themselves.' };
      }
    }

    // Rule: Cannot downgrade Superadmin
    if (targetUser.role === UserRole.superadmin && role && role !== UserRole.superadmin) {
      return { success: false, error: 'The Superadmin (Creator) cannot be downgraded or have their role changed.' };
    }

    // Rule: Cannot promote Guest who hasn't finished onboarding
    if (role && (role === 'admin' || role === 'member')) {
      if (targetUser.onboardingStatus !== OnboardingStatus.approved) {
        return { 
          success: false, 
          error: `User ${targetUser.displayName} has not completed onboarding. Please approve them using 'approve_user' first.` 
        };
      }
    }


    // 3. Admin Limits (1 Super, 2 Admins)
    if (role === 'admin' && targetUser.role !== UserRole.admin) {
      const adminCount = await this.prisma.user.count({ where: { role: UserRole.admin } });
      if (adminCount >= 2) {
        return { 
          success: false, 
          error: `Limit reached: The squad already has the maximum of 2 Admins. Cannot promote ${targetUser.displayName} (@${targetUser.username}).` 
        };
      }
    }

    if (role === 'superadmin' && targetUser.role !== UserRole.superadmin) {
      const superCount = await this.prisma.user.count({ where: { role: UserRole.superadmin } });
      if (superCount >= 1) {
        return { 
          success: false, 
          error: `Limit reached: The squad already has 1 Superadmin (Creator). Cannot promote ${targetUser.displayName} to this role.` 
        };
      }
    }


    // 4. Update data construction
    const updateData: Prisma.UserUpdateInput = {};
    if (displayName) updateData.displayName = displayName;

    // We extract existing personaJson to merge it properly
    const existingPersona = (targetUser.personaJson as Record<string, any>) || {};
    const newPersona = { ...existingPersona };

    if (personaSummary !== undefined) newPersona.summary = personaSummary;
    if (coreSkills !== undefined) newPersona.coreSkills = coreSkills;
    if (pronouns !== undefined) newPersona.pronouns = pronouns;

    if (Object.keys(newPersona).length > 0) {
      updateData.personaJson = newPersona;
    } // Role and Onboarding Logic
    if (role === 'guest') {
      updateData.role = UserRole.guest;
      updateData.onboardingStatus = OnboardingStatus.denied; // Triggers "unknown" state in detector
      
      // Also clear any active onboarding sessions for a clean restart
      await this.prisma.onboardingSession.deleteMany({
        where: { telegramId: actualTargetId }
      }).catch(err => this.logger.warn(`Failed to clear sessions for ${actualTargetId}`, err));
    } else if (role) {
      updateData.role = role as UserRole;
      updateData.onboardingStatus = OnboardingStatus.approved;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { telegramId: actualTargetId },
        data: updateData,
      });

      this.logger.log(`Profile updated for ${updated.displayName} by ${requester.displayName}`);

      return {
        success: true,
        data: {
          message: `Successfully updated profile for ${updated.displayName}. ${role === 'guest' ? 'User has been reset to Guest status and will require re-onboarding.' : ''}`,
          user: {
            id: updated.id,
            displayName: updated.displayName,
            role: updated.role,
            onboardingStatus: updated.onboardingStatus,
            persona: updated.personaJson
          },
        },
      };
    } catch (err: any) {
      this.logger.error(`Failed to update user ${targetUserId}`, err);
      return { success: false, error: `Database error: ${err.message}` };
    }

  }
}
