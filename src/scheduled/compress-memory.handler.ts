import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { UpstashRedisService, GeminiService } from '@app/common';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { WarmMemoryService } from '../memory/warm.memory.service';
import { HotMemoryService } from '../memory/hot.memory.service';
import type { HotMemoryEntry } from '@app/common/types/agent.types';

const COMPRESS_THRESHOLD = 15; // Compress if hot memory has more than this many entries
const ENTRIES_TO_COMPRESS = 10; // Take the oldest N entries to summarise

@Injectable()
export class CompressMemoryHandler {
  private readonly logger = new Logger(CompressMemoryHandler.name);

  constructor(
    private readonly redisService: UpstashRedisService,
    private readonly hotMemory: HotMemoryService,
    private readonly warmMemory: WarmMemoryService,
    private readonly geminiService: GeminiService,
  ) {}

  async handle(job: Job): Promise<void> {
    this.logger.log('[COMPRESS] Starting nightly memory compression...');

    // Scan Redis for all hot memory keys using cursor-based SCAN
    let cursor = 0;
    const hotKeys: string[] = [];

    do {
      const result = await this.redisService.client.scan(cursor, {
        match: 'hot:*',
        count: 100,
      });
      cursor = parseInt(result[0] as unknown as string, 10);
      hotKeys.push(...result[1]);
    } while (cursor !== 0);

    this.logger.log(`[COMPRESS] Found ${hotKeys.length} hot memory key(s) to evaluate`);

    let compressed = 0;

    for (const key of hotKeys) {
      const chatId = key.replace('hot:', '');
      try {
        const history: HotMemoryEntry[] = await this.hotMemory.getHistory(chatId);

        if (history.length <= COMPRESS_THRESHOLD) {
          continue; // Not large enough to warrant compression
        }

        // Take oldest N entries to summarise
        const toCompress = history.slice(0, ENTRIES_TO_COMPRESS);
        const remainder = history.slice(ENTRIES_TO_COMPRESS);

        // Build a transcript of the oldest messages
        const transcript = toCompress
          .map((m) => `${m.role === 'user' ? 'User' : 'Elena'}: ${m.text ?? '[media]'}`)
          .join('\n');

        // Summarise with Gemini Flash Lite (fast + cheap for this)
        const summaryResult = await this.geminiService.generateContent(
          GEMINI_MODELS.FALLBACK_LITE,
          [
            {
              role: 'user',
              parts: [
                {
                  text: `Summarise the key points from this squad chat conversation in 2–3 concise sentences. 
Focus on decisions made, tasks assigned, and important context. 
Keep it factual and brief — this summary will be used as long-term memory context.

Conversation:
${transcript}`,
                },
              ],
            },
          ],
        );

        const summary = summaryResult.text?.trim();
        if (!summary) {
          this.logger.warn(`[COMPRESS] Gemini returned empty summary for chat ${chatId}. Skipping.`);
          continue;
        }

        // Determine a representative userId from the compressed entries
        const userEntry = toCompress.find((m) => m.role === 'user');
        const userId = userEntry?.userId ?? 'system';

        // Store summary as a warm memory point in Qdrant
        await this.warmMemory.store(summary, {
          userId,
          chatId,
          accessLevel: 'public',
          source: 'hot_compression',
          compressedAt: new Date().toISOString(),
          originalEntryCount: toCompress.length,
        });

        // Safely remove the items we just summarized from the LIVE history
        await this.hotMemory.removeOldest(chatId, ENTRIES_TO_COMPRESS);

        this.logger.log(
          `[COMPRESS] Compressed ${toCompress.length} entries for chat ${chatId} → warm memory.`,
        );
        compressed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[COMPRESS] Failed to compress chat ${chatId}: ${msg}`);
      }
    }

    this.logger.log(`[COMPRESS] Nightly compression complete. Compressed ${compressed}/${hotKeys.length} chat(s).`);
  }
}
