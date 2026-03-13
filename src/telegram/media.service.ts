import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ReplySenderService } from './reply.sender';
import got from 'got';

/**
 * Service to handle downloading media files from Telegram.
 */
@Injectable()
export class TelegramMediaService {
    private readonly logger = new Logger(TelegramMediaService.name);

    constructor(
        @Inject(forwardRef(() => ReplySenderService))
        private readonly replySender: ReplySenderService,
    ) {}

    /**
     * Downloads a file from Telegram and returns its base64 encoded content.
     */
    async downloadFileBase64(fileId: string): Promise<{ data: string; mimeType: string } | null> {
        try {
            const bot = this.replySender.getBot();
            
            // 1. Get file path from Telegram
            const file = await bot.api.getFile(fileId);
            if (!file.file_path) {
                this.logger.warn(`No file path returned for fileId: ${fileId}`);
                return null;
            }

            // 2. Download file content
            const token = process.env['TELEGRAM_BOT_TOKEN'];
            const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            
            this.logger.log(`Downloading file from Telegram: ${file.file_path}`);
            const response = await got(url, { responseType: 'buffer' });
            
            const buffer = response.body;
            const base64 = buffer.toString('base64');

            // Guess mime type from path extension if possible, or use fallback
            const extension = file.file_path.split('.').pop()?.toLowerCase();
            let mimeType = 'image/jpeg'; // Default for photos
            if (extension === 'png') mimeType = 'image/png';
            if (extension === 'webp') mimeType = 'image/webp';
            if (extension === 'ogg') mimeType = 'audio/ogg';
            if (extension === 'mp4') mimeType = 'video/mp4';

            return {
                data: base64,
                mimeType,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to download Telegram file ${fileId}: ${message}`);
            return null;
        }
    }
}
