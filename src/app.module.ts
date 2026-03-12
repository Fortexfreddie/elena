import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@app/database';
import { GeminiModule } from '@app/common';
import { TelegramModule } from './telegram/telegram.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { SafetyModule } from './safety/safety.module.js';
import { SecretsModule } from './secrets/secrets.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { AuditModule } from './audit/audit.module.js';
import { ScheduledModule } from './scheduled/scheduled.module.js';
import { HealthController } from './health.controller.js';

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
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'info',
        autoLogging: false, // Don't log every HTTP request — too noisy with Telegram webhooks
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
        enableOfflineQueue: true, // Waiting room for brief blips
        connectTimeout: 20000,
        commandTimeout: 30000, // Kept higher for slow round-trips
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
export class AppModule { }

/**
 * Parse Redis URL components for ioredis connection.
 * Upstash URLs: rediss://default:PASSWORD@HOST:PORT
 */
function extractRedisHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'localhost';
  }
}

function extractRedisPort(url: string): number {
  try {
    const parsed = new URL(url);
    return parsed.port ? parseInt(parsed.port, 10) : 6379;
  } catch {
    return 6379;
  }
}

function extractRedisPassword(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.password;
  } catch {
    return '';
  }
}
