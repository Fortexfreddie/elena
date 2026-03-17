import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { PrismaService } from '@app/database/database.service';
import { BountyStatus, Prisma } from '@prisma/client';

@Injectable()
export class BountyUpdateTool implements AgentTool {
  private readonly logger = new Logger(BountyUpdateTool.name);

  name = 'bounty_update';
  description =
    'Manage project bounties and tasks. Supports creating, updating, and listing open bounties.';
  requiresConfirmation = true; // High-stakes database operation

  constructor(private readonly prisma: PrismaService) {}

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            description: 'The action to perform.',
            enum: ['create', 'update', 'list'],
          },
          bountyId: {
            type: Type.STRING,
            description: 'The UUID of the bounty (required for update).',
          },
          title: {
            type: Type.STRING,
            description: 'Title of the bounty.',
          },
          description: {
            type: Type.STRING,
            description: 'Detailed description of the bounty.',
          },
          status: {
            type: Type.STRING,
            description: 'The status of the bounty.',
            enum: ['open', 'in_progress', 'submitted', 'completed', 'dropped'],
          },
        },
        required: ['action'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const action = args['action'] as string;
    const userId = context.parsedMessage.userId; // We assume this is the DB UUID from Assembler

    this.logger.log(`Executing bounty_update [${action}] for user ${userId}`);

    try {
      // Find internal user ID based on telegram ID (since context might only have telegram ID in placeholder or real DB ID)
      // Wait, AssemblerService usually pulls the full User object.
      // In Phase 4, AgentContext has assembledContext.userProfile (from DB).
      const internalUserId = context.assembledContext.userProfile?.id;
      if (!internalUserId)
        return { success: false, error: 'User not found in system.' };

      switch (action) {
        case 'create': {
          const title = args['title'] as string;
          if (!title)
            return { success: false, error: 'Title is required for create.' };

          const bounty = await this.prisma.bounty.create({
            data: {
              title,
              description: args['description'] as string | undefined,
              createdById: internalUserId,
              status: BountyStatus.open,
            },
          });
          return {
            success: true,
            data: {
              message: 'Bounty created successfully.',
              bountyId: bounty.id,
            },
          };
        }
        case 'update': {
          const bountyId = args['bountyId'] as string;
          if (!bountyId)
            return {
              success: false,
              error: 'BountyId is required for update.',
            };

          const data: Prisma.BountyUpdateInput = {};
          if (args['status']) data.status = args['status'] as BountyStatus;
          if (args['description'])
            data.description = args['description'] as string;
          if (args['title']) data.title = args['title'] as string;

          await this.prisma.bounty.update({
            where: { id: bountyId },
            data,
          });
          return {
            success: true,
            data: { message: 'Bounty updated successfully.' },
          };
        }
        case 'list': {
          const bounties = await this.prisma.bounty.findMany({
            where: {
              status: { in: [BountyStatus.open, BountyStatus.in_progress] },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });
          return { success: true, data: bounties };
        }
        default:
          return { success: false, error: `Action '${action}' not supported.` };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bounty update failed: ${msg}`);
      return { success: false, error: `Bounty update failed: ${msg}` };
    }
  }
}
