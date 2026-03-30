import { Injectable, Logger } from '@nestjs/common';
import { UpstashRedisService, sleep } from '@app/common';
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
      let parsed: unknown;
      try {
        parsed = typeof data === 'string' ? JSON.parse(data) : data;
      } catch (err) {
        this.logger.error(
          `Failed to parse hot memory JSON for ${chatId}: ${String(err)}`,
        );
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed as HotMemoryEntry[];
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
      await this.redisService.client.set(
        `hot:${chatId}`,
        JSON.stringify(toSave),
        { ex: this.TTL_SECONDS },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save hot memory for ${chatId}: ${msg}`);
    }
  }

  /**
   * Convenience method to append a new message.
   */
  async addMessage(chatId: string, message: HotMemoryEntry): Promise<void> {
    const lockKey = `hot:lock:${chatId}`;
    const acquired = await this.redisService.client.set(lockKey, '1', {
      nx: true,
      ex: 5,
    });

    if (!acquired) {
      // wait 100ms and retry once
      await sleep(100);
      const retry = await this.redisService.client.set(lockKey, '1', {
        nx: true,
        ex: 5,
      });
      if (!retry) {
        this.logger.warn(
          `Hot memory lock contention on chat ${chatId} — dropping write to prevent corruption`,
        );
        return; // Drop this write rather than risk corrupting the list
      }
    }

    try {
      const history = await this.getHistory(chatId);
      history.push(message);
      await this.saveHistory(chatId, history);
    } finally {
      await this.redisService.client.del(lockKey);
    }
  }

  /**
   * Safely remove the first N messages from history using a lock.
   * Prevents race conditions during memory compression.
   */
  async removeOldest(chatId: string, count: number): Promise<void> {
    const lockKey = `hot:lock:${chatId}`;
    const acquired = await this.redisService.client.set(lockKey, '1', {
      nx: true,
      ex: 5,
    });

    if (!acquired) {
      await sleep(100);
      const retry = await this.redisService.client.set(lockKey, '1', {
        nx: true,
        ex: 5,
      });
      if (!retry) return; // Drop if highly contested
    }

    try {
      const history = await this.getHistory(chatId);
      if (history.length === 0) return;
      
      const remainder = history.slice(count);
      await this.saveHistory(chatId, remainder);
    } finally {
      await this.redisService.client.del(lockKey);
    }
  }
}
