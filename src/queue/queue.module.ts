import { Module, forwardRef, Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { MessageProcessor } from './message.processor';
import { HitlProcessor } from './hitl.processor';
import { QUEUE_NAMES } from './job.types';
import { AgentsModule } from '../agents/agents.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MemoryModule } from '../memory/index';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ToolsModule } from '../tools/tools.module';
import { SafetyModule } from '../safety/safety.module';

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
const providers: Provider[] = [QueueService];

// Only enable the consumer logic if this is the worker process
// I-2: PROCESS_TYPE is evaluated statically at module load time. 
// This prevents runtime hot-swapping between webhook and worker modes, which is intentional for deployment isolation.
if (process.env['PROCESS_TYPE'] === 'worker') {
  providers.push(MessageProcessor);
  providers.push(HitlProcessor);
}

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.MESSAGES },
      { name: QUEUE_NAMES.HITL },
      { name: QUEUE_NAMES.SCHEDULED },
    ),
    forwardRef(() => AgentsModule),
    forwardRef(() => ToolsModule),
    MemoryModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => TelegramModule),
    SafetyModule,
  ],
  providers,
  exports: [QueueService],
})
export class QueueModule {}
