import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ReplySenderService } from './reply.sender';
import got from 'got';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

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
    async downloadFileBase64(fileId: string, providedMimeType?: string | null): Promise<{ data: string; mimeType: string } | null> {
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
            if (!buffer || buffer.length === 0) {
                this.logger.warn(`Downloaded buffer is empty for fileId: ${fileId}`);
                return {
                    data: 'ERROR: Media download returned zero bytes. Please describe the image manually or try another file.',
                    mimeType: 'text/plain',
                };
            }
            const base64 = buffer.toString('base64');

            // 3. Determine mime type
            // Priority 1: User-provided mime type (from message.parser.ts)
            if (providedMimeType && providedMimeType !== 'application/octet-stream') {
                return { data: base64, mimeType: providedMimeType };
            }

            // Priority 2: Guess from path extension
            const extension = file.file_path.split('.').pop()?.toLowerCase();
            let mimeType = providedMimeType ?? 'application/octet-stream';

            const mimeMap: Record<string, string> = {
                // Images
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'webp': 'image/webp',
                'heic': 'image/heic',
                'heif': 'image/heif',
                // Audio
                'wav': 'audio/wav',
                'mp3': 'audio/mpeg',
                'm4a': 'audio/mp4',
                'ogg': 'audio/ogg',
                'oga': 'audio/ogg',
                'aac': 'audio/aac',
                'flac': 'audio/flac',
                // Video
                'mp4': 'video/mp4',
                'mpeg': 'video/mpeg',
                'mov': 'video/quicktime',
                'avi': 'video/x-msvideo',
                'webm': 'video/webm',
                '3gp': 'video/3gpp',
                // Documents (Gemini Pro treats text/plain as the core for all text-based formats)
                'pdf': 'application/pdf',
                'txt': 'text/plain',
                'md': 'text/plain',
                'csv': 'text/plain',
            };

            if (extension && mimeMap[extension]) {
                mimeType = mimeMap[extension];
            }

            return {
                data: base64,
                mimeType,
            };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const sanitized = msg.replace(
                /\/bot[A-Za-z0-9_:]+\//g,
                '/bot[REDACTED]/'
            );
            throw new Error(`Media download failed: ${sanitized}`);
        }
    }

    /**
     * Downloads a file from Telegram and saves it to a temporary file.
     * Required for files > 10MB to use the Gemini File API.
     */
    async downloadToTempFile(fileId: string): Promise<string | null> {
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
            
            this.logger.log(`Downloading large file to temp storage: ${file.file_path}`);
            const response = await got(url, { responseType: 'buffer' });
            
            const buffer = response.body;
            if (!buffer || buffer.length === 0) {
                this.logger.warn(`Downloaded buffer is empty for fileId: ${fileId}`);
                return null;
            }

            // 3. Save to temp file
            const tempDir = os.tmpdir();
            const extension = file.file_path.split('.').pop() || 'tmp';
            const tempPath = path.join(tempDir, `elena_media_${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`);
            
            await fs.writeFile(tempPath, buffer);
            return tempPath;
            
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const sanitized = msg.replace(
                /\/bot[A-Za-z0-9_:]+\//g,
                '/bot[REDACTED]/'
            );
            throw new Error(`Media temp download failed: ${sanitized}`);
        }
    }
}
