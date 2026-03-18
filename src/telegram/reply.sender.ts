import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Bot, InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, ForceReply } from 'grammy/types';
import { autoRetry } from '@grammyjs/auto-retry';
import { chunkMessage, escapeHtml, escapeMarkdownV2 } from '@app/common';

/**
 * Sends replies to Telegram group chats via Grammy.
 * Uses @grammyjs/auto-retry to respect Telegram's retry_after on 429.
 * Chunks messages >4096 chars using the markdown-aware chunker.
 *
 * Bot ID is resolved eagerly at module init — no lazy race condition.
 */
@Injectable()
export class ReplySenderService implements OnModuleInit {
  private readonly logger = new Logger(ReplySenderService.name);
  private readonly bot: Bot;
  private botId: number | null = null;

  constructor() {
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    this.bot = new Bot(token);
    this.bot.api.config.use(autoRetry());
  }

  /**
   * Eagerly resolve botId on module init.
   * Fails fast on boot if the token is invalid.
   */
  async onModuleInit(): Promise<void> {
    try {
      const me = await this.bot.api.getMe();
      this.botId = me.id;
      this.logger.log(`Bot ID resolved: ${String(this.botId)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to resolve bot ID on init: ${message}`);
      throw error; // Fail fast — bot token is likely invalid
    }
  }

  /**
   * Get the bot instance for use in other services.
   * Grammy is used as an outbound API client only — no bot.on() listeners.
   */
  getBot(): Bot {
    return this.bot;
  }

  /**
   * Get the bot's own user ID. Eagerly resolved at init.
   * Throws if called before init somehow.
   */
  getBotId(): number {
    if (this.botId === null) {
      throw new Error('Bot ID not initialized');
    }
    return this.botId;
  }

  /**
   * Send a reply to a chat. Chunks long messages automatically.
   * @param chatId Telegram chat ID
   * @param text The message content
   * @param replyToMessageId Optional ID to reply to
   * @param parseMode Optional parse_mode. 'MarkdownV2' uses smart escaper.
   * @param escape Whether to auto-escape the text.
   * @param replyMarkup Optional inline keyboard.
   */
  async sendReply(
    chatId: string,
    text: string,
    replyToMessageId?: number,
    parseMode: 'MarkdownV2' | 'HTML' | null = 'MarkdownV2',
    escape: boolean = true,
    replyMarkup?: InlineKeyboard | InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply,
  ): Promise<void> {


    let processedText = text;
    if (escape) {
      if (parseMode === 'MarkdownV2') {
        processedText = escapeMarkdownV2(text);
      } else if (parseMode === 'HTML') {
        processedText = escapeHtml(text);
      }
    }

    const chunks = chunkMessage(processedText);

    for (let i = 0; i < chunks.length; i++) {
      try {
        await this.bot.api.sendMessage(chatId, chunks[i], {
          parse_mode: parseMode ?? undefined,
          reply_markup: i === 0 ? replyMarkup : undefined,
          // Only reply to the original message on the first chunk
          ...(i === 0 && replyToMessageId
            ? { reply_parameters: { message_id: replyToMessageId } }
            : {}),
        });

      } catch (error: unknown) {
        // FALLBACK: if MarkdownV2 fails (often a 400 Bad Request due to unescaped chars)
        // we try sending again as plain text without parse_mode.
        try {
          this.logger.warn(
            `Failed to send reply chunk ${i + 1}/${chunks.length} with parse_mode=${parseMode}. Falling back to plain text.`,
          );
          await this.bot.api.sendMessage(chatId, chunks[i], {
            ...(i === 0 && replyToMessageId
              ? { reply_parameters: { message_id: replyToMessageId } }
              : {}),
          });
        } catch (fallbackError: unknown) {
          const message =
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unknown Telegram send error';
          this.logger.error(
            `Failed to send reply chunk ${i + 1}/${chunks.length} to chat ${chatId} (even with fallback): ${message}`,
          );
          throw fallbackError;
        }
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
      const message =
        error instanceof Error ? error.message : 'Unknown chat action error';
      this.logger.debug(
        `Could not send typing action to chat ${chatId}: ${message}`,
      );
    }
  }
}
