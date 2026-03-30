import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GeminiService } from '@app/common/gemini/gemini.service';

const STALE_HOURS = 24;

@Injectable()
export class CleanupGeminiFilesHandler {
  private readonly logger = new Logger(CleanupGeminiFilesHandler.name);

  constructor(private readonly geminiService: GeminiService) {}

  async handle(job: Job): Promise<void> {
    this.logger.log('[CLEANUP] Starting Gemini File API cleanup...');

    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    let deleted = 0;
    let skipped = 0;
    let errors = 0;

    try {
      // The GeminiService exposes `ai` privately — we access via the public files wrapper
      // We'll call listFiles() which we add as a public method below
      const files = await this.geminiService.listFiles();

      this.logger.log(`[CLEANUP] Found ${files.length} file(s) in Gemini File API`);

      for (const file of files) {
        const createTime = file.createTime ? new Date(file.createTime) : null;

        if (!createTime || isNaN(createTime.getTime())) {
          this.logger.warn(`[CLEANUP] File ${file.name} has no valid createTime — skipping`);
          skipped++;
          continue;
        }

        if (createTime < cutoff) {
          try {
            await this.geminiService.deleteFile(file.name!);
            this.logger.log(`[CLEANUP] Deleted stale file: ${file.name} (created ${createTime.toISOString()})`);
            deleted++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`[CLEANUP] Failed to delete ${file.name}: ${msg}`);
            errors++;
          }
        } else {
          skipped++;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CLEANUP] Failed to list Gemini files: ${msg}`);
      return;
    }

    this.logger.log(
      `[CLEANUP] Done — deleted: ${deleted}, skipped: ${skipped}, errors: ${errors}`,
    );
  }
}
