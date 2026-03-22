import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Injectable()
export class CleanupGeminiFilesHandler {
  private readonly logger = new Logger(CleanupGeminiFilesHandler.name);

  async handle(job: Job): Promise<void> {
    // Phase 6: List and delete stale Gemini File API uploads
    this.logger.log('[SCHEDULED] cleanup-gemini-files: Phase 6 placeholder');
  }
}
