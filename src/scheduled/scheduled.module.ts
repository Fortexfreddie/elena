import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduledProcessor } from './scheduled.processor';
import { ReminderDeliveryHandler } from './reminder-delivery.handler';
import { PurgeSecretsHandler } from './purge-secrets.handler';
import { CompressMemoryHandler } from './compress-memory.handler';
import { CleanupGeminiFilesHandler } from './cleanup-gemini-files.handler';
import { MorningMessageHandler } from './morning-message.handler';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';
import { SecretsModule } from '../secrets/secrets.module';
import { MemoryModule } from '../memory/memory.module';
import { GeminiModule, UpstashRedisModule } from '@app/common';
import { QUEUE_NAMES } from '../queue/job.types';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULED }),
    PrismaModule,
    GeminiModule,
    UpstashRedisModule,
    MemoryModule,
    forwardRef(() => TelegramModule),
    forwardRef(() => SecretsModule),
  ],
  providers: [
    ScheduledProcessor,
    ReminderDeliveryHandler,
    PurgeSecretsHandler,
    CompressMemoryHandler,
    CleanupGeminiFilesHandler,
    MorningMessageHandler,
  ],
  exports: [
    ScheduledProcessor,
    ReminderDeliveryHandler,
    PurgeSecretsHandler,
    CompressMemoryHandler,
    CleanupGeminiFilesHandler,
    MorningMessageHandler,
  ],
})
export class ScheduledModule {}
