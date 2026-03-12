import type {
    ParsedMessage,
    TelegramUpdate,
    TelegramMessage,
} from '@app/common/types/telegram.types';
import { MAX_MEDIA_FILE_SIZE } from '@app/common/gemini/gemini.constants';

const TWENTY_MB = MAX_MEDIA_FILE_SIZE;

/**
 * Converts a raw Telegram Update into a ParsedMessage.
 *
 * Handles all media types with correct mime_type fallbacks per Telegram Bot API docs:
 * - photo: hardcode 'image/jpeg' (PhotoSize has NO mime_type)
 * - video_note: hardcode 'video/mp4' (VideoNote has NO mime_type)
 * - voice: use mime_type ?? 'audio/ogg'
 * - video: use mime_type ?? 'video/mp4'
 * - document: use mime_type ?? 'application/octet-stream'
 */
export function parseMessage(
    update: TelegramUpdate,
    botId: number,
): ParsedMessage | null {
    const message = update.message;
    if (!message) {
        return null;
    }

    const from = message.from;
    if (!from) {
        return null;
    }

    // Don't process messages from bots
    if (from.is_bot) {
        return null;
    }

    const chatId = String(message.chat.id);
    const userId = String(from.id);
    const isDm = message.chat.type === 'private';
    const telegramDate = message.date;
    const updateId = update.update_id;

    // Check if this is a reply to the bot's message
    const replyToBot = isReplyToBot(message, botId);

    // Extract text (may be null for media-only messages)
    const text = message.text ?? null;

    // Extract media
    const media = extractMedia(message);

    return {
        userId,
        chatId,
        text: media.oversizeNote ? media.oversizeNote : text,
        telegramDate,
        updateId,
        replyToBot,
        isDm,
        hasMedia: media.hasMedia,
        mediaFileId: media.fileId,
        mediaFileSize: media.fileSize,
        mediaType: media.mimeType,
        rawUpdate: update,
    };
}

function isReplyToBot(message: TelegramMessage, botId: number): boolean {
    const replyTo = message.reply_to_message;
    if (!replyTo) return false;

    const replyFrom = replyTo.from;
    if (!replyFrom) return false;

    return replyFrom.id === botId;
}

interface MediaExtraction {
    hasMedia: boolean;
    fileId: string | null;
    fileSize: number | null;
    mimeType: string | null;
    oversizeNote: string | null;
}

function extractMedia(message: TelegramMessage): MediaExtraction {
    const noMedia: MediaExtraction = {
        hasMedia: false,
        fileId: null,
        fileSize: null,
        mimeType: null,
        oversizeNote: null,
    };

    // Photo — array of sizes, pick the largest (last element)
    if (message.photo && message.photo.length > 0) {
        const largest = message.photo[message.photo.length - 1];
        const fileSize = largest.file_size ?? null;

        if (fileSize !== null && fileSize > TWENTY_MB) {
            return {
                ...noMedia,
                oversizeNote: '[System: file too large to process (>20MB)]',
            };
        }

        return {
            hasMedia: true,
            fileId: largest.file_id,
            fileSize,
            mimeType: 'image/jpeg', // PhotoSize has NO mime_type field
            oversizeNote: null,
        };
    }

    // Voice
    if (message.voice) {
        const fileSize = message.voice.file_size ?? null;

        if (fileSize !== null && fileSize > TWENTY_MB) {
            return {
                ...noMedia,
                oversizeNote: '[System: voice note too large to process (>20MB)]',
            };
        }

        return {
            hasMedia: true,
            fileId: message.voice.file_id,
            fileSize,
            mimeType: message.voice.mime_type ?? 'audio/ogg',
            oversizeNote: null,
        };
    }

    // Video
    if (message.video) {
        const fileSize = message.video.file_size ?? null;

        if (fileSize !== null && fileSize > TWENTY_MB) {
            return {
                ...noMedia,
                oversizeNote: '[System: video too large to process (>20MB)]',
            };
        }

        return {
            hasMedia: true,
            fileId: message.video.file_id,
            fileSize,
            mimeType: message.video.mime_type ?? 'video/mp4',
            oversizeNote: null,
        };
    }

    // Video Note (circular video)
    if (message.video_note) {
        const fileSize = message.video_note.file_size ?? null;

        if (fileSize !== null && fileSize > TWENTY_MB) {
            return {
                ...noMedia,
                oversizeNote:
                    '[System: video note too large to process (>20MB)]',
            };
        }

        return {
            hasMedia: true,
            fileId: message.video_note.file_id,
            fileSize,
            mimeType: 'video/mp4', // VideoNote has NO mime_type field
            oversizeNote: null,
        };
    }

    // Document
    if (message.document) {
        const fileSize = message.document.file_size ?? null;

        if (fileSize !== null && fileSize > TWENTY_MB) {
            return {
                ...noMedia,
                oversizeNote: '[System: document too large to process (>20MB)]',
            };
        }

        return {
            hasMedia: true,
            fileId: message.document.file_id,
            fileSize,
            mimeType: message.document.mime_type ?? 'application/octet-stream',
            oversizeNote: null,
        };
    }

    return noMedia;
}
