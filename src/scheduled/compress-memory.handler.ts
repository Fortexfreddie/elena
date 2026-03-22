import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Injectable()
export class CompressMemoryHandler {
  private readonly logger = new Logger(CompressMemoryHandler.name);

  async handle(job: Job): Promise<void> {
    // Phase 6: Summarize old hot memory into warm memory
    this.logger.log('[SCHEDULED] compress-memory: Phase 6 placeholder');
  }
}
