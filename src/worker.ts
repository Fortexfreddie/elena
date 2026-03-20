import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
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
import { QueueModule } from './queue/queue.module';
import { validateEnv } from '@app/config';
import { TelegramModule } from './telegram/telegram.module';
import { AgentsModule } from './agents/agents.module';
import { ScheduledModule } from './scheduled/scheduled.module';

/**
 * Worker module — imports only what the BullMQ worker needs.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? {
                targets: [
                  {
                    target: 'pino-pretty',
                    options: { colorize: true },
                    level: 'debug',
                  },
                  {
                    target: 'pino/file',
                    options: { destination: './error.log' },
                    level: 'info',
                  },
                ],
              }
            : undefined,
        level: process.env['NODE_ENV'] !== 'production' ? 'debug' : 'info',
      },
    }),
    BullModule.forRoot({
      connection: {
        host: extractRedisHost(process.env['UPSTASH_REDIS_URL'] ?? ''),
        port: extractRedisPort(process.env['UPSTASH_REDIS_URL'] ?? ''),
        password: extractRedisPassword(process.env['UPSTASH_REDIS_URL'] ?? ''),
        tls: {
          rejectUnauthorized: false,
        },
        enableOfflineQueue: true, // L-3: Buffer commands during brief Redis disconnections in the worker process
        connectTimeout: 20000,
        commandTimeout: 30000,
        family: 4,
        retryStrategy(times: number) {
          return Math.min(times * 100, 3000);
        },
        keepAlive: 10000,
        maxRetriesPerRequest: null,
      },
    }),
    PrismaModule,
    GeminiModule,
    UpstashRedisModule,
    TelegramModule,
    AgentsModule,
    QueueModule,
    ScheduledModule,
  ],
})
class WorkerModule {}

/**
 * Worker bootstrap — separate NestJS standalone application.
 * No HTTP server. Processes BullMQ jobs only.
 *
 * Cloud Run worker service command: node dist/worker
 * MUST call enableShutdownHooks — Cloud Run sends SIGTERM with 10s window.
 * BullMQ lockDuration=30000 and maxStalledCount=2 handle Gemini Pro's 15-25s latency.
 */
async function bootstrap(): Promise<void> {
  validateEnv(process.env as Record<string, string | undefined>);

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Required: NestJS does not handle SIGTERM by default.
  // On SIGTERM: NestJS hooks fire → QueueModule OnApplicationShutdown → worker.close()
  // BullMQ drains current jobs gracefully within Cloud Run's 10-second window.
  app.enableShutdownHooks();

  const logger = app.get(Logger);
  
  // L-6: Manual temp file sweep on start (e.g. leftover downloaded media files generated if a previous worker crashed)
  try {
    const { tmpdir } = await import('os');
    const { readdir, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const tmp = tmpdir();
    const files = await readdir(tmp);
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith('tg-dl-') || file.startsWith('voice-') || file.endsWith('.ogg')) {
        await unlink(join(tmp, file)).catch(() => {});
        cleaned++;
      }
    }
    if (cleaned > 0) logger.log(`Cleaned ${cleaned} orphaned temp files from OS temp directory.`);
  } catch (err) {
    logger.warn('Failed to sweep OS temp files on start:', err);
  }

  logger.log('Elena worker started');
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start Elena worker:', err);
  process.exit(1);
});
