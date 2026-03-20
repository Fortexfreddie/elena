import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { ReplySenderService } from './reply.sender';

@Injectable()
export class SecurityAlertService {
  private readonly logger = new Logger(SecurityAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly replySender: ReplySenderService,
  ) {}

  /**
   * Sends an alert to all superadmins about a stranger messaging Elena in DMs.
   */
  async sendStrangerAlert(
    telegramId: string,
    displayName: string,
    username: string | null,
    text: string | null,
  ): Promise<void> {
    try {
      const superadmins = await this.prisma.user.findMany({
        where: { role: 'superadmin' },
        select: { telegramId: true, displayName: true },
      });

      if (superadmins.length === 0) {
        this.logger.warn('[SECURITY] No superadmins found to notify about stranger activity.');
        return;
      }

      const formattedUsername = username ? `@${username}` : 'No username';
      const alertText = `🛡️ *STRANGER ACTIVITY ALERT*\n\nAn unknown user (not in database) is messaging Elena in DMs.\n\n👤 *Name:* ${displayName}\n🆔 *ID:* ${telegramId}\n🌐 *Username:* ${formattedUsername}\n💬 *Message:* ${text || '[Media Only]'}`;

      for (const admin of superadmins) {
        try {
          await this.replySender.sendReply(
            admin.telegramId,
            alertText,
            undefined,
            'MarkdownV2',
          );
        } catch (err) {
          this.logger.error(`Failed to send stranger alert to superadmin ${admin.telegramId}`, err);
        }
      }
      this.logger.log(`[SECURITY] Stranger activity alert sent to ${superadmins.length} superadmins for user ${telegramId}`);
    } catch (error) {
      this.logger.error('[SECURITY] Failed to process stranger alert', error);
    }
  }

  /**
   * Generic Guest Activity Alert for users who are in the DB but not yet approved.
   */
  async sendGuestActivityAlert(
    telegramId: string,
    displayName: string,
    username: string | null,
    text: string | null,
    status: 'pending' | 'guest' | 'denied',
  ): Promise<void> {
    try {
       const superadmins = await this.prisma.user.findMany({
        where: { role: 'superadmin' },
        select: { telegramId: true, displayName: true },
      });

      if (superadmins.length === 0) return;

      const formattedUsername = username ? `@${username}` : 'No username';
      const alertText = `🛡️ *GUEST ACTIVITY ALERT*\n\nAn unapproved user (${status.toUpperCase()}) is messaging Elena.\n\n👤 *Name:* ${displayName}\n🆔 *ID:* ${telegramId}\n🌐 *Username:* ${formattedUsername}\n💬 *Message:* ${text || '[Media Only]'}`;

      for (const admin of superadmins) {
         try {
          await this.replySender.sendReply(
            admin.telegramId,
            alertText,
            undefined,
            'MarkdownV2',
          );
        } catch (err) {
          this.logger.error(`Failed to send guest alert to superadmin ${admin.telegramId}`, err);
        }
      }
    } catch (error) {
      this.logger.error('[SECURITY] Failed to process guest activity alert', error);
    }
  }
}
