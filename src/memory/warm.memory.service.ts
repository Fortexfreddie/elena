import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GeminiService } from '@app/common';
import type { WarmResult } from '@app/common/types/agent.types';
import { EMBEDDING_DIMENSIONS } from '@app/common/gemini/gemini.constants';
import * as crypto from 'crypto';

@Injectable()
export class WarmMemoryService implements OnModuleInit {
  private readonly logger = new Logger(WarmMemoryService.name);
  private client: QdrantClient | null = null;
  private collectionName = process.env['QDRANT_COLLECTION'] ?? 'elena-memory';

  constructor(private readonly geminiService: GeminiService) {
    const url = process.env['QDRANT_URL'];
    const apiKey = process.env['QDRANT_API_KEY'];

    if (url && apiKey) {
      this.client = new QdrantClient({ url, apiKey });
      this.logger.log(
        `Initialized Qdrant client for collection: ${this.collectionName}`,
      );
    } else {
      this.logger.warn(
        'Qdrant URL or API key not configured. Warm memory will be disabled.',
      );
    }
  }

  async onModuleInit() {
    if (!this.client) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName,
      );

      if (!exists) {
        this.logger.log(
          `Collection ${this.collectionName} not found. Creating...`,
        );
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: EMBEDDING_DIMENSIONS,
            distance: 'Cosine',
          },
        });
        this.logger.log(
          `Successfully created collection: ${this.collectionName}`,
        );
      } else {
        const info = await this.client.getCollection(this.collectionName);
        this.logger.log(
          `Warm memory collection details: dim=${JSON.stringify(info.config.params.vectors)}`,
        );
      }

      // Create payload indexes if they don't exist
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'accessLevel',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'userId',
        field_schema: 'keyword',
      });
      this.logger.log(
        `Ensured payload indexes exist for 'accessLevel' and 'userId'`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to check/create Qdrant collection: ${msg}`);
    }
  }

  /**
   * Performs a semantic search using Qdrant.
   * Only returns results matching public access or the specific user.
   */
  async search(query: string, userId: string): Promise<WarmResult[]> {
    if (!this.client || !userId) return [];
    if (!query || query.trim().length < 5) return [];

    try {
      const vector = await this.geminiService.embed(query);
      this.logger.debug(`Generated Vector Dimension: ${vector.length}`);

      const results = await this.client.query(this.collectionName, {
        query: vector,
        limit: 5,
        filter: {
          should: [
            { key: 'accessLevel', match: { value: 'public' } },
            { key: 'userId', match: { value: String(userId) } },
          ],
        },
        with_payload: true,
      });

      return results.points.map((r) => ({
        text: (r.payload?.['text'] as string) ?? '',
        score: r.score,
        metadata: r.payload as Record<string, unknown>,
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const detail =
        (error as any)?.body?.message ||
        (error as any)?.response?.data?.message ||
        '';
      this.logger.error(
        `Warm memory search failed for query [${query.slice(0, 50)}...]: ${msg} ${detail}`,
      );
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
        points: [
          {
            id: pointId,
            vector,
            payload: { text, ...metadata },
          },
        ],
      });
      this.logger.debug(`Stored warm memory point: ${pointId}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Warm memory store failed: ${msg}`);
    }
  }
}
