/**
 * Parsed representation of a Telegram Update for Elena's pipeline.
 * Produced by message.parser.ts, consumed by the queue and agents.
 */
export interface ParsedMessage {
    /** Telegram user ID as string */
    userId: string;
    /** Telegram chat ID as string */
    chatId: string;
    /** Message text content — null for media-only messages */
    text: string | null;
    /** Unix timestamp in seconds — primary sort key for hot memory */
    telegramDate: number;
    /** Telegram update_id — sequential tiebreaker for same-second sort */
    updateId: number;
    /** Whether this is a reply to Elena's message */
    replyToBot: boolean;
    /** Whether this is a direct message (not a group) */
    isDm: boolean;
    /** Whether the message contains processable media */
    hasMedia: boolean;
    /** Telegram file_id for media — never base64 */
    mediaFileId: string | null;
    /** File size in bytes — null if no media */
    mediaFileSize: number | null;
    /** MIME type string, e.g. 'image/jpeg', 'audio/ogg' — null if no media */
    mediaType: string | null;
    /** Context if this is a reply to another message */
    replyToContext: {
        text: string | null;
        userId: string;
        displayName: string;
    } | null;
    /** The raw Telegram Update object for fallback access */
    rawUpdate: TelegramUpdate;
}

/**
 * Minimal typed subset of a Telegram Update for parsing.
 * Grammy's Update type is the full source, but we type what we actually use.
 */
export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
}

export interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    sender_chat?: TelegramChat; 
    date: number;
    chat: TelegramChat;
    text?: string;
    entities?: MessageEntity[]; 
    caption?: string;
    caption_entities?: MessageEntity[]; 
    reply_to_message?: TelegramMessage;
    forward_origin?: unknown; 
    edit_date?: number; 
    media_group_id?: string; 
    has_protected_content?: boolean; 
    via_bot?: TelegramUser; 
    photo?: TelegramPhotoSize[];
    voice?: TelegramVoice;
    video?: TelegramVideo;
    video_note?: TelegramVideoNote;
    document?: TelegramDocument;
}

export interface MessageEntity {
    type: string;
    offset: number;
    length: number;
    url?: string;
    user?: TelegramUser;
    language?: string;
    custom_emoji_id?: string;
}

export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
}

export interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
    // PhotoSize has NO mime_type field in TG API
}

export interface TelegramVoice {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
}

export interface TelegramVideo {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    mime_type?: string;
    file_size?: number;
}

export interface TelegramVideoNote {
    file_id: string;
    file_unique_id: string;
    length: number;
    duration: number;
    file_size?: number;
    // VideoNote has NO mime_type field in TG API
}

export interface TelegramDocument {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}
