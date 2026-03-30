import { Injectable, Logger } from '@nestjs/common';
import { UpstashRedisService } from '@app/common';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  // Phase 6 Requirements: 20 messages per 60 seconds per user
  private readonly MAX_REQUESTS = 20;
  private readonly WINDOW_SECONDS = 60;

  constructor(private readonly redisService: UpstashRedisService) {}

  /**
   * Checks if a user has exceeded their rate limit window.
   * Uses a Redis Sorted Set (ZSET) to implement a sliding window log.
   *
   * @param userId The Telegram ID of the user
   * @returns RateLimitResult indicating if the request should proceed
   */
  async check(userId: string): Promise<RateLimitResult> {
    const key = `ratelimit:${userId}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SECONDS * 1000;

    try {
      // Pipeline command execution to reduce latency:
      // 1. ZREMRANGEBYSCORE: Remove elements older than the window
      // 2. ZADD: Add current timestamp (score and value are both timestamp)
      // 3. ZCARD: Count elements in the window
      // 4. EXPIRE: Set TTL on the key so inactive ones clean up automatically

      const pipeline = this.redisService.client.pipeline();

      const member = `${now}-${Math.random().toString(36).slice(2, 9)}`;

      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, { score: now, member }); // Use unique string to avoid overwriting members on identical ms
      pipeline.zcard(key);
      pipeline.expire(key, this.WINDOW_SECONDS + 10);

      const results = await pipeline.exec();

      if (!results) {
        this.logger.warn(`Rate limit pipeline failed for ${userId} (null response)`);
        return { allowed: true, remaining: 1 }; // Fail open
      }

      // results[2] is the output of zcard
      const countResult = results[2];
      
      // Handle the fact that Upstash pipeline results are [error, result] tuples occasionally, 
      // but the type is generic. 
      const count = Array.isArray(countResult) && countResult.length === 2 
        ? (countResult[1] as number) 
        : (countResult as number);

      const allowed = count <= this.MAX_REQUESTS;

      if (!allowed) {
        this.logger.warn(
          `[RATE_LIMIT] User ${userId} exceeded limit (${count}/${this.MAX_REQUESTS} in ${this.WINDOW_SECONDS}s)`,
        );
      }

      return {
        allowed,
        remaining: Math.max(0, this.MAX_REQUESTS - count),
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RATE_LIMIT] Check failed for user ${userId}: ${msg}`);
      return { allowed: true, remaining: 1 }; // Fail open to maintain availability
    }
  }
}
