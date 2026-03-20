import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { DmDispatcherService } from '../telegram/dm.dispatcher';

@Injectable()
export class SecretExpiryService {
  private readonly logger = new Logger(SecretExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dmDispatcher: DmDispatcherService,
  ) {}

  /**
   * Finds and deletes all expired secrets.
   * DMs the owner before deletion.
   * Called by PurgeSecretsHandler repeatable job.
   */
  async purgeExpiredSecrets(): Promise<void> {
    const now = new Date();
    
    const expired = await this.prisma.secret.findMany({
      where: { expiresAt: { lte: now } },
      include: { owner: { select: { telegramId: true, displayName: true } } },
    });

    this.logger.log(`[PURGE] Found ${expired.length} expired secrets`);

    for (const secret of expired) {
      try {
        // Notify owner
        await this.dmDispatcher.sendDm(
          secret.owner.telegramId,
          `🔐 Your secret *${secret.label}* has expired and been automatically deleted.`,
        );
      } catch (err) {
        this.logger.warn(`Failed to DM owner for expired secret ${secret.id}`);
      }

      // Delete
      await this.prisma.secret.delete({ where: { id: secret.id } });
      this.logger.log(`[PURGE] Deleted expired secret ${secret.id} (${secret.label})`);
    }
  }
}
