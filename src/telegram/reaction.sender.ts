import { Injectable, Logger } from '@nestjs/common';
import { ReplySenderService } from './reply.sender.js';

/**
 * Sends a "thinking" reaction to the message after Stage 1 pass.
 * Uses Telegram's setMessageReaction API.
 */
@Injectable()
export class ReactionSenderService {
    private readonly logger = new Logger(ReactionSenderService.name);

    constructor(private readonly replySender: ReplySenderService) { }

    /**
     * Send a thinking emoji reaction to a message.
     * Non-fatal — if it fails, processing continues.
     */
    async sendThinkingReaction(
        chatId: string,
        messageId: number,
    ): Promise<void> {
        try {
            const bot = this.replySender.getBot();
            await bot.api.setMessageReaction(chatId, messageId, [
                { type: 'emoji', emoji: '🤔' },
            ]);
        } catch (error: unknown) {
            // Reactions may fail in channels, old chats, or if bot lacks permissions
            const message =
                error instanceof Error ? error.message : 'Unknown reaction error';
            this.logger.debug(
                `Could not set thinking reaction on ${chatId}/${messageId}: ${message}`,
            );
        }
    }
}
