import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { MessageProcessor } from './message.processor';
import { QUEUE_NAMES } from './job.types';
import { AgentsModule } from '../agents/agents.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MemoryModule } from '../memory/index';
import { forwardRef } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';

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
const providers: any[] = [QueueService];

// Only enable the consumer logic if this is the worker process
if (process.env['PROCESS_TYPE'] === 'worker') {
    providers.push(MessageProcessor);
}

@Module({
    imports: [
        BullModule.registerQueue(
            { name: QUEUE_NAMES.MESSAGES },
            { name: QUEUE_NAMES.HITL },
            { name: QUEUE_NAMES.SCHEDULED },
        ),
        AgentsModule,
        MemoryModule,
        forwardRef(() => OnboardingModule),
        forwardRef(() => TelegramModule),
    ],
    providers,
    exports: [QueueService],
})
export class QueueModule { }
