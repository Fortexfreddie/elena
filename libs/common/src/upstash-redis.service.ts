import { Injectable } from '@nestjs/common';
import { Redis } from '@upstash/redis';

/**
 * Shared @upstash/redis REST client provider.
 *
 * Used by WebhookController (dedup gate) and Phase 2+ HotMemoryService.
 * Single instance avoids creating duplicate REST clients.
 *
 * NOTE: This is the REST client (@upstash/redis) — NOT the ioredis TCP client
 * used by BullMQ. Two different protocols, same Upstash instance.
 */
@Injectable()
export class UpstashRedisService {
  public readonly client: Redis;

  constructor() {
    const url = process.env['UPSTASH_REDIS_REST_URL'];
    const token = process.env['UPSTASH_REDIS_TOKEN'];

    if (!url || !token) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_TOKEN are required',
      );
    }

    this.client = new Redis({ url, token });
  }
}
