import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';

@Injectable()
export class UserGroupService {
  private readonly logger = new Logger(UserGroupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all groups a user is known to be in.
   * Returns chatId and lastSeenAt for each group.
   */
  async getUserGroups(
    userId: string,
  ): Promise<{ chatId: string; chatName: string | null; lastSeenAt: Date }[]> {
    const groups = await this.prisma.userGroup.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { chatId: true, chatName: true, lastSeenAt: true },
    });
    return groups;
  }

  /**
   * Get the most recently active group for a user.
   * Used when user asks for a group reminder from DM.
   */
  async getMostRecentGroup(
    userId: string,
  ): Promise<{ chatId: string; chatName: string | null } | null> {
    const group = await this.prisma.userGroup.findFirst({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { chatId: true, chatName: true },
    });
    return group;
  }
}
