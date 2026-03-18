import { Injectable, Logger } from '@nestjs/common';
import { ReplySenderService } from './reply.sender.js';

/**
 * Sends private DMs to users via Telegram.
 * Audit logging will be added in Phase 5.
 */
@Injectable()
export class DmDispatcherService {
  private readonly logger = new Logger(DmDispatcherService.name);

  constructor(private readonly replySender: ReplySenderService) {}

  /**
   * Send a private DM to a user by their Telegram user ID.
   */
  async sendDm(userId: string, text: string): Promise<void> {
    await this.replySender.sendReply(userId, text);
    this.logger.log(`DM sent to user ${userId}`);
  }
}
