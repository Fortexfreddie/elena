import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service.js';
import { MessageProcessor } from './message.processor.js';
import { QUEUE_NAMES } from './job.types.js';
import { AgentsModule } from '../agents/agents.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { forwardRef } from '@nestjs/common';

/**
 * Queue module — registers BullMQ queues with shared ioredis connection.
 *
 * Three queues share a single ioredis instance to minimize Upstash connections:
 * - elena-messages: main message processing
 * - elena-hitl: human-in-the-loop confirmations
 * - elena-scheduled: repeatable cron jobs
 *
 * ioredis connection options for Cloud Run serverless TCP survival:
 *   enableOfflineQueue: false — fast-fail on dead connection
 *   commandTimeout: 30000    — don't hang on dead sockets
 *   keepAlive: 10000         — detect dead connections via TCP keepalive
 */
@Module({
    imports: [
        BullModule.registerQueue(
            { name: QUEUE_NAMES.MESSAGES },
            { name: QUEUE_NAMES.HITL },
            { name: QUEUE_NAMES.SCHEDULED },
        ),
        AgentsModule,
        forwardRef(() => TelegramModule),
    ],
    providers: [QueueService, MessageProcessor],
    exports: [QueueService],
})
export class QueueModule { }
