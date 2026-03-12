import { parseMessage } from './message.parser';
import { MAX_MEDIA_FILE_SIZE } from '@app/common/gemini/gemini.constants';

describe('MessageParser', () => {
    const BOT_ID = 12345;

    it('should return null if there is no message', () => {
        const update: any = { update_id: 1 };
        expect(parseMessage(update, BOT_ID)).toBeNull();
    });

    it('should return null if the message is from a bot', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: true },
                chat: { id: 111, type: 'private' },
                date: 1234567,
            },
        };
        expect(parseMessage(update, BOT_ID)).toBeNull();
    });

    it('should parse a basic text message', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: false },
                chat: { id: 111, type: 'private' },
                date: 1234567,
                text: 'hello world',
            },
        };

        const result = parseMessage(update, BOT_ID);
        expect(result).not.toBeNull();
        expect(result?.text).toBe('hello world');
        expect(result?.userId).toBe('6789');
        expect(result?.chatId).toBe('111');
        expect(result?.isDm).toBe(true);
        expect(result?.hasMedia).toBe(false);
    });

    it('should identify a reply to the bot', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: false },
                chat: { id: 111, type: 'private' },
                date: 1234567,
                text: 'reply text',
                reply_to_message: {
                    from: { id: BOT_ID, is_bot: true }
                }
            },
        };

        const result = parseMessage(update, BOT_ID);
        expect(result?.replyToBot).toBe(true);
    });

    it('should parse a photo message', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: false },
                chat: { id: 111, type: 'supergroup' },
                date: 1234567,
                photo: [
                    { file_id: 'small', file_size: 100 },
                    { file_id: 'large', file_size: 1000 }
                ],
            },
        };

        const result = parseMessage(update, BOT_ID);
        expect(result?.hasMedia).toBe(true);
        expect(result?.mediaFileId).toBe('large');
        expect(result?.mediaType).toBe('image/jpeg');
        expect(result?.isDm).toBe(false);
    });

    it('should handle oversize files', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: false },
                chat: { id: 111, type: 'private' },
                date: 1234567,
                document: {
                    file_id: 'huge',
                    file_size: MAX_MEDIA_FILE_SIZE + 100,
                    mime_type: 'application/pdf'
                },
            },
        };

        const result = parseMessage(update, BOT_ID);
        expect(result?.hasMedia).toBe(false); // parser returns null media if oversize
        expect(result?.text).toContain('too large');
    });

    it('should extract mime_type from document if available', () => {
        const update: any = {
            update_id: 1,
            message: {
                from: { id: 6789, is_bot: false },
                chat: { id: 111, type: 'private' },
                date: 1234567,
                document: {
                    file_id: 'doc',
                    file_size: 100,
                    mime_type: 'application/pdf'
                },
            },
        };

        const result = parseMessage(update, BOT_ID);
        expect(result?.mediaType).toBe('application/pdf');
    });
});
