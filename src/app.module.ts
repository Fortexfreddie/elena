import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@app/database';
import { GeminiModule, UpstashRedisModule } from '@app/common';
import {
    extractRedisHost,
    extractRedisPort,
    extractRedisPassword,
} from '@app/common/utils/redis-url';
import { TelegramModule } from './telegram/telegram.module';
import { QueueModule } from './queue/queue.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';
import { ToolsModule } from './tools/tools.module';
import { PersonasModule } from './personas/personas.module';
import { SafetyModule } from './safety/safety.module';
import { SecretsModule } from './secrets/secrets.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuditModule } from './audit/audit.module';
import { ScheduledModule } from './scheduled/scheduled.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Config — validates env vars on startup
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Logging — structured JSON via Pino
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? {
              targets: [
                { target: 'pino-pretty', options: { colorize: true }, level: 'debug' },
                { target: 'pino/file', options: { destination: './error.log' }, level: 'info' }
              ]
            }
            : undefined,
        level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'info',
        autoLogging: false,
      },
    }),

    // BullMQ — shared ioredis connection for all queues
    BullModule.forRoot({
      connection: {
        host: extractRedisHost(process.env['UPSTASH_REDIS_URL'] ?? ''),
        port: extractRedisPort(process.env['UPSTASH_REDIS_URL'] ?? ''),
        password: extractRedisPassword(
          process.env['UPSTASH_REDIS_URL'] ?? '',
        ),
        tls: {
          rejectUnauthorized: false, // Handle TLS blips
        },
        enableOfflineQueue: false, // Fast-fail on dead connection after scale-to-zero wake
        connectTimeout: 20000,
        commandTimeout: 10000, // Fast enough to detect dead sockets, tolerant of network latency
        family: 4, // FORCE IPv4 (Crucial for NG ISPs)
        retryStrategy(times: number) {
          return Math.min(times * 100, 3000);
        },
        keepAlive: 10000,
        maxRetriesPerRequest: null, // Required for BullMQ
      },
    }),

    // Database
    PrismaModule,

    // AI
    GeminiModule,

    // Upstash Redis REST client (shared)
    UpstashRedisModule,

    // Feature modules
    TelegramModule,
    QueueModule,
    AgentsModule,
    MemoryModule,
    ToolsModule,
    PersonasModule,
    SafetyModule,
    SecretsModule,
    OnboardingModule,
    AuditModule,
    ScheduledModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
