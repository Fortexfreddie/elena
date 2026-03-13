import { Injectable, Logger } from '@nestjs/common';
import { UpstashRedisService } from '@app/common';
import type { HotMemoryEntry } from '@app/common/types/agent.types';

@Injectable()
export class HotMemoryService {
    private readonly logger = new Logger(HotMemoryService.name);
    private readonly TTL_SECONDS = 2 * 60 * 60; // 2 hours

    constructor(private readonly redisService: UpstashRedisService) {}

    /**
     * Get the recent message history for a chat.
     */
    async getHistory(chatId: string): Promise<HotMemoryEntry[]> {
        try {
            const data = await this.redisService.client.get(`hot:${chatId}`);
            if (!data) return [];
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to fetch hot memory for ${chatId}: ${msg}`);
            return []; // Non-fatal
        }
    }

    /**
     * Save the entire message history (overwrites).
     * Automatically truncates to the last 15 messages to stay under limits.
     */
    async saveHistory(chatId: string, messages: HotMemoryEntry[]): Promise<void> {
        try {
            const toSave = messages.slice(-15);
            await this.redisService.client.set(`hot:${chatId}`, JSON.stringify(toSave), { ex: this.TTL_SECONDS });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to save hot memory for ${chatId}: ${msg}`);
        }
    }

    /**
     * Convenience method to append a new message.
     */
    async addMessage(chatId: string, message: HotMemoryEntry): Promise<void> {
        const history = await this.getHistory(chatId);
        history.push(message);
        await this.saveHistory(chatId, history);
    }
}
