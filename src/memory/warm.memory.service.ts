import { Injectable, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GeminiService } from '@app/common';
import type { WarmResult } from '@app/common/types/agent.types';
import * as crypto from 'crypto';

@Injectable()
export class WarmMemoryService {
    private readonly logger = new Logger(WarmMemoryService.name);
    private client: QdrantClient | null = null;
    private collectionName = process.env['QDRANT_COLLECTION'] ?? 'elena-memory';

    constructor(private readonly geminiService: GeminiService) {
        const url = process.env['QDRANT_URL'];
        const apiKey = process.env['QDRANT_API_KEY'];
        
        if (url && apiKey) {
            this.client = new QdrantClient({ url, apiKey });
            this.logger.log(`Initialized Qdrant client for collection: ${this.collectionName}`);
        } else {
            this.logger.warn('Qdrant URL or API key not configured. Warm memory will be disabled.');
        }
    }

    /**
     * Performs a semantic search using Qdrant.
     * Only returns results matching public access or the specific user.
     */
    async search(query: string, userId: string): Promise<WarmResult[]> {
        if (!this.client) return [];
        
        try {
            const vector = await this.geminiService.embed(query);
            
            const results = await this.client.search(this.collectionName, {
                vector,
                limit: 5,
                filter: {
                    should: [
                        { key: 'accessLevel', match: { value: 'public' } },
                        { key: 'userId', match: { value: userId } }
                    ]
                }
            });

            return results.map(r => ({
                text: (r.payload?.['text'] as string) ?? '',
                score: r.score,
                metadata: r.payload as Record<string, unknown>
            }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Warm memory search failed: ${msg}`);
            return []; // Fails open
        }
    }

    /**
     * Embeds and stores text into Qdrant.
     */
    async store(text: string, metadata: Record<string, unknown>): Promise<void> {
        if (!this.client) return;
        
        try {
            const vector = await this.geminiService.embed(text);
            const pointId = crypto.randomUUID();
            
            await this.client.upsert(this.collectionName, {
                wait: true,
                points: [{
                    id: pointId,
                    vector,
                    payload: { text, ...metadata }
                }]
            });
            this.logger.debug(`Stored warm memory point: ${pointId}`);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Warm memory store failed: ${msg}`);
        }
    }
}
