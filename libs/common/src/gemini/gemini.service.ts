import { Injectable, Logger } from '@nestjs/common';
import { sleep } from '../utils/sleep';
import {
  GoogleGenAI,
  type GenerateContentResponse as SDKGenerateContentResponse,
  type Content,
  type GenerateContentConfig,
  type FunctionCall,
} from '@google/genai';
import { ModelError } from '../types/errors';
import {
  GEMINI_MODELS,
  EMBEDDING_DIMENSIONS,
  type GeminiModel,
} from './gemini.constants';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';

/**
 * Single wrapper around @google/genai SDK.
 * ALL agents call through this service — no agent imports the SDK directly.
 *
 * Responsibilities:
 * - generateContent: with PRO→FALLBACK retry on 429/500, never sets temperature
 * - embed: gemini-embedding-001 with outputDimensionality=768
 * - uploadFile / deleteFile: Gemini File API for media >10MB
 */
@Injectable()
export class GeminiService {
  private readonly ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      throw new ModelError('GEMINI_API_KEY is not set');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Generate content using a Gemini model.
   *
   * - Preserves raw candidates[0].content for thought signature passthrough
   * - Falls back from PRO to FLASH on 429/500
   * - NEVER sets temperature (Gemini 3.1 default 1.0 is correct)
   * - systemInstruction carries persona + rules + context (NOT in messages[])
   */
  async generateContent(
    requestedModel: GeminiModel,
    contents: Content[],
    config: GenerateContentConfig = {},
  ): Promise<ElenaGenerateContentResponse> {
    // Define fallback tiers for maximum reliability
    // Tier 1 (Target) -> Tier 2 (Flash) -> Tier 3 (Flash Lite)
    const chain: GeminiModel[] = [requestedModel];

    if (requestedModel === GEMINI_MODELS.PRO) {
      chain.push(GEMINI_MODELS.FALLBACK); // Flash
      chain.push(GEMINI_MODELS.FALLBACK_LITE); // Flash Lite
    } else if (
      requestedModel === GEMINI_MODELS.FLASH ||
      requestedModel === GEMINI_MODELS.FILTER
    ) {
      // Already mid-tier, only one safety net left
      if (requestedModel !== GEMINI_MODELS.FALLBACK_LITE) {
        chain.push(GEMINI_MODELS.FALLBACK_LITE);
      }
    }

    // De-duplicate in case constants overlap
    const modelChain = Array.from(new Set(chain));
    let lastError: unknown;

    for (let i = 0; i < modelChain.length; i++) {
      const currentModel = modelChain[i];
      const isLast = i === modelChain.length - 1;

      try {
        const response = await this.ai.models.generateContent({
          model: currentModel,
          contents,
          config: {
            ...config,
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
              },
            ],
          },
        });

        return this.parseResponse(response, currentModel);
      } catch (error: unknown) {
        lastError = error;

        // If it's a structural error (not transient), don't bother retrying
        if (error instanceof ModelError) throw error;

        const statusCode = extractStatusCode(error);
        const isTransient =
          statusCode === 429 || statusCode === 500 || statusCode === 503;

        if (isTransient && !isLast) {
          const nextModel = modelChain[i + 1];
          this.logger.warn(
            `Tier ${i + 1} (${currentModel}) failed with ${statusCode}. Retrying with Tier ${i + 2} (${nextModel})...`,
          );

          const waitSec = this.extractRetryAfter(error);
          if (waitSec > 0) await sleep(waitSec * 1000);
          continue;
        }

        // If not transient or it's our last hope, exit the loop
        break;
      }
    }

    const finalError =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new ModelError(
      `Multi-tier fallback failed. Final model tried: ${modelChain[modelChain.length - 1]}. Error: ${finalError}`,
    );
  }

  /**
   * Parse SDK response into Elena's response type.
   */
  private parseResponse(
    response: SDKGenerateContentResponse,
    model: GeminiModel,
  ): ElenaGenerateContentResponse {
    // Stage 1: Check if the prompt itself was blocked (e.g., PROHIBITED_CONTENT)
    if (response.promptFeedback?.blockReason) {
      throw new ModelError(
        `Gemini blocked the prompt at the source. Reason: ${response.promptFeedback.blockReason}.`,
      );
    }

    // Stage 2: Check for empty candidates (often due to safety filters mid-generation)
    if (
      !response.candidates ||
      response.candidates.length === 0 ||
      !response.candidates[0].content
    ) {
      const finishReason = response.candidates?.[0]?.finishReason;
      const safetyRatings = JSON.stringify(response.candidates?.[0]?.safetyRatings);
      
      this.logger.error(`[SAFETY_DEBUG] Model ${model} returned zero candidates. FinishReason: ${finishReason}. SafetyRatings: ${safetyRatings}`);
      
      throw new ModelError(
        `Empty response from ${model} — likely blocked by safety filters (FinishReason: ${finishReason})`,
      );
    }

    // Extract function calls if present
    const functionCalls: FunctionCallResult[] = [];
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const fc of response.functionCalls) {
        if (fc.name) {
          functionCalls.push({
            name: fc.name,
            args: (fc.args as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    // Extract text parts manually to avoid SDK warning on multi-part responses
    let extractedText = '';
    if (response.candidates[0].content.parts) {
      extractedText = response.candidates[0].content.parts
        .filter((p) => 'text' in p && p.text)
        .map((p) => p.text)
        .join('\n');
    }

    return {
      text: extractedText,
      rawContent: response.candidates[0].content,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      model,
    };
  }

  /**
   * Generate an embedding vector for the given text.
   * Uses gemini-embedding-001 with outputDimensionality=768.
   */
  async embed(
    text: string,
    taskType: string = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: GEMINI_MODELS.EMBEDDING,
        contents: text,
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: taskType,
        },
      });

      if (!response.embeddings || response.embeddings.length === 0) {
        throw new ModelError(
          'Empty embedding response — no embeddings returned',
        );
      }

      const values = response.embeddings[0].values;
      if (!values || values.length === 0) {
        throw new ModelError('Embedding returned empty values array');
      }

      return values;
    } catch (error: unknown) {
      if (error instanceof ModelError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown embedding error';
      throw new ModelError(`Embedding failed: ${message}`);
    }
  }

  /**
   * Upload a file to the Gemini File API for media >10MB.
   * Returns both fileUri (for agent) and name (for deleteFile cleanup).
   * Caller MUST call deleteFile in a finally block.
   */
  async uploadFile(
    localPath: string,
    mimeType: string,
  ): Promise<{ fileUri: string; name: string }> {
    try {
      const uploadResult = await this.ai.files.upload({
        file: localPath,
        config: { mimeType },
      });

      if (!uploadResult.uri || !uploadResult.name) {
        throw new ModelError('File upload returned no uri or name');
      }

      return {
        fileUri: uploadResult.uri,
        name: uploadResult.name,
      };
    } catch (error: unknown) {
      if (error instanceof ModelError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown upload error';
      throw new ModelError(`File upload failed: ${message}`);
    }
  }

  /**
   * Delete a file from Google's servers.
   * MUST be called after every uploadFile — files count against 20GB quota.
   * Always call in a finally block so cleanup runs even if an agent throws.
   */
  async deleteFile(name: string): Promise<void> {
    try {
      await this.ai.files.delete({ name });
    } catch (error: unknown) {
      // Log but don't throw — this is cleanup, shouldn't mask the real error
      const message =
        error instanceof Error ? error.message : 'Unknown delete error';
      this.logger.warn(`Failed to delete Gemini file ${name}: ${message}`);
    }
  }

  /**
   * Generate an image using Gemini image generation model.
   * Returns base64 encoded image data and mime type.
   * Returns null if generation fails or no image in response.
   */
  async generateImage(
    prompt: string,
  ): Promise<{ data: string; mimeType: string } | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODELS.IMAGE,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      
      for (const part of parts) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          return {
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          };
        }
      }

      this.logger.warn('[IMAGE_GEN] No image data in response');
      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // Fast-fail on quota — return null immediately so fallback kicks in
      if (
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('quota') ||
        msg.includes('429') ||
        msg.includes('free_tier')
      ) {
        this.logger.warn(
          '[IMAGE_GEN] Quota exceeded on image model — returning null for fallback',
        );
        return null;
      }

      this.logger.error(`[IMAGE_GEN] Generation failed: ${msg}`);
      return null;
    }
  }
  private extractRetryAfter(error: unknown): number {
    if (error instanceof Error) {
      const match = error.message.match(/retry after (\d+)/i);
      if (match?.[1]) return parseInt(match[1], 10);
    }
    return 2; // default 2 second wait if no header found
  }
}

/**
 * Elena's parsed response from GeminiService.generateContent()
 */
export interface ElenaGenerateContentResponse {
  /** Extracted text from the response */
  text: string;
  /** Raw content from candidates[0].content — MUST be pushed to messages[] as-is for thought signatures */
  rawContent: Content;
  /** Function calls if present — undefined if pure text response */
  functionCalls?: FunctionCallResult[];
  /** Model that actually handled the request (may differ from requested if fallback triggered) */
  model: GeminiModel;
}

interface FunctionCallResult {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Extract HTTP status code from SDK errors.
 */
function extractStatusCode(error: unknown): number | null {
  if (error && typeof error === 'object') {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }
    if ('statusCode' in error && typeof error.statusCode === 'number') {
      return error.statusCode;
    }
  }
  return null;
}
