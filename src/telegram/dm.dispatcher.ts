import { Injectable, Logger } from '@nestjs/common';
import { ReplySenderService } from './reply.sender.js';
import { PrismaService } from '@app/database';

/**
 * Sends private DMs to users via Telegram.
 * Includes persistent AuditLog entries for compliance tracking.
 */
@Injectable()
export class DmDispatcherService {
  private readonly logger = new Logger(DmDispatcherService.name);

  constructor(
    private readonly replySender: ReplySenderService,
    private readonly prisma: PrismaService, // M-8
  ) {}

  /**
   * Send a private DM to a user by their Telegram user ID.
   */
  async sendDm(userId: string, text: string): Promise<void> {
    await this.replySender.sendReply(userId, text);
    this.logger.log(`DM sent to user ${userId}`);

    // M-8: Audit logging for DMs
    await this.prisma.auditLog.create({
      data: {
        actionType: 'DM_DISPATCH',
        toolCalled: 'send_dm',
        sanitizedSummary: `Sent DM to ${userId}: ${text.length > 50 ? text.substring(0, 50) + '...' : text}`,
      },
    }).catch(err => this.logger.error(`Failed to audit log DM: ${err}`));
  }
}
