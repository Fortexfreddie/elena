import { Module, Global } from '@nestjs/common';
import { UpstashRedisService } from './upstash-redis.service';

/**
 * Global module for the shared @upstash/redis REST client.
 * Import once in AppModule — available everywhere via DI.
 */
@Global()
@Module({
    providers: [UpstashRedisService],
    exports: [UpstashRedisService],
})
export class UpstashRedisModule { }
