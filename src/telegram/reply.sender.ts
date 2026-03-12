import { Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { chunkMessage } from '@app/common/utils/chunk';

/**
 * Sends replies to Telegram group chats via Grammy.
 * Uses @grammyjs/auto-retry to respect Telegram's retry_after on 429.
 * Chunks messages >4096 chars using the markdown-aware chunker.
 */
@Injectable()
export class ReplySenderService {
    private readonly logger = new Logger(ReplySenderService.name);
    private readonly bot: Bot;

    constructor() {
        const token = process.env['TELEGRAM_BOT_TOKEN'];
        if (!token) {
            throw new Error('TELEGRAM_BOT_TOKEN is not set');
        }

        this.bot = new Bot(token);
        this.bot.api.config.use(autoRetry());
    }

    /**
     * Get the bot instance for use in other services.
     * Grammy is used as an outbound API client only — no bot.on() listeners.
     */
    getBot(): Bot {
        return this.bot;
    }

    /**
     * Get the bot's own user ID for reply detection.
     */
    async getBotId(): Promise<number> {
        const me = await this.bot.api.getMe();
        return me.id;
    }

    /**
     * Send a reply to a chat. Chunks long messages automatically.
     */
    async sendReply(
        chatId: string,
        text: string,
        replyToMessageId?: number,
    ): Promise<void> {
        const chunks = chunkMessage(text);

        for (let i = 0; i < chunks.length; i++) {
            try {
                await this.bot.api.sendMessage(chatId, chunks[i], {
                    parse_mode: 'Markdown',
                    // Only reply to the original message on the first chunk
                    ...(i === 0 && replyToMessageId
                        ? { reply_parameters: { message_id: replyToMessageId } }
                        : {}),
                });
            } catch (error: unknown) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Unknown Telegram send error';
                this.logger.error(
                    `Failed to send reply chunk ${i + 1}/${chunks.length} to chat ${chatId}: ${message}`,
                );
                // Don't throw — best effort. If one chunk fails, try the rest.
            }
        }
    }

    /**
     * Send a "typing..." status to the chat.
     */
    async sendTypingAction(chatId: string): Promise<void> {
        try {
            await this.bot.api.sendChatAction(chatId, 'typing');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown chat action error';
            this.logger.debug(`Could not send typing action to chat ${chatId}: ${message}`);
        }
    }
}
