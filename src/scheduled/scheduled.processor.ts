import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue/job.types';
import { ReminderDeliveryHandler } from './reminder-delivery.handler';
import { PurgeSecretsHandler } from './purge-secrets.handler';
import { CompressMemoryHandler } from './compress-memory.handler';
import { CleanupGeminiFilesHandler } from './cleanup-gemini-files.handler';

@Processor(QUEUE_NAMES.SCHEDULED, {
  concurrency: 3,
  lockDuration: 60000,
})
export class ScheduledProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledProcessor.name);

  constructor(
    private readonly reminderHandler: ReminderDeliveryHandler,
    private readonly purgeHandler: PurgeSecretsHandler,
    private readonly compressHandler: CompressMemoryHandler,
    private readonly cleanupHandler: CleanupGeminiFilesHandler,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(
      `[SCHEDULED] Processing job: ${job.name} (id: ${job.id})`,
    );

    switch (job.name) {
      case 'reminder-delivery':
        return this.reminderHandler.handle(job);
      case 'purge-secrets':
        return this.purgeHandler.handle(job);
      case 'compress-memory':
        return this.compressHandler.handle(job);
      case 'cleanup-gemini-files':
        return this.cleanupHandler.handle(job);
      default:
        this.logger.warn(
          `[SCHEDULED] Unknown job name: ${job.name} — skipping`,
        );
    }
  }
}
