import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduledProcessor } from './scheduled.processor';
import { ReminderDeliveryHandler } from './reminder-delivery.handler';
import { PurgeSecretsHandler } from './purge-secrets.handler';
import { CompressMemoryHandler } from './compress-memory.handler';
import { CleanupGeminiFilesHandler } from './cleanup-gemini-files.handler';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';
import { SecretsModule } from '../secrets/secrets.module';
import { QUEUE_NAMES } from '../queue/job.types';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULED }),
    PrismaModule,
    forwardRef(() => TelegramModule),
    forwardRef(() => SecretsModule),
  ],
  providers: [
    ScheduledProcessor,
    ReminderDeliveryHandler,
    PurgeSecretsHandler,
    CompressMemoryHandler,
    CleanupGeminiFilesHandler,
  ],
  exports: [
    ScheduledProcessor,
    ReminderDeliveryHandler,
    PurgeSecretsHandler,
    CompressMemoryHandler,
    CleanupGeminiFilesHandler,
  ],
})
export class ScheduledModule {}
