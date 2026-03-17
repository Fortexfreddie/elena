import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import type { UserProfile, BountyInfo } from '@app/common/types/agent.types';

@Injectable()
export class ColdMemoryService {
  private readonly logger = new Logger(ColdMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches user profile from Postgres via Prisma.
   * Returns null if the user does not exist.
   */
  async getUserProfile(telegramId: string): Promise<UserProfile | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
      });

      if (!user) return null;

      return {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        personaJson: user.personaJson as Record<string, unknown>,
        preferencesJson: user.preferencesJson as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to fetch user profile for ${telegramId}: ${msg}`,
      );
      return null;
    }
  }

  /**
   * Retrieves active bounties (open or in_progress) created by or assigned to the user.
   */
  async getActiveBounties(userId: string): Promise<BountyInfo[]> {
    try {
      const bounties = await this.prisma.bounty.findMany({
        where: {
          OR: [{ createdById: userId }, { assignedToId: userId }],
          status: { in: ['open', 'in_progress'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return bounties.map((b) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        status: b.status,
        platform: b.platform,
        deadline: b.deadline,
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch bounties for ${userId}: ${msg}`);
      return [];
    }
  }
}
