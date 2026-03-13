import { Injectable, Logger } from '@nestjs/common';
import {
    GoogleGenAI,
    type GenerateContentResponse as SDKGenerateContentResponse,
    type Content,
    type GenerateContentConfig,
    type FunctionCall,
} from '@google/genai';
import { ModelError } from '../types/errors';
import { GEMINI_MODELS, EMBEDDING_DIMENSIONS, type GeminiModel } from './gemini.constants';

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
        model: GeminiModel,
        contents: Content[],
        config: GenerateContentConfig = {},
    ): Promise<ElenaGenerateContentResponse> {
        try {
            const response = await this.ai.models.generateContent({
                model,
                contents,
                config,
            });

            return this.parseResponse(response, model);
        } catch (error: unknown) {
            if (error instanceof ModelError) {
                throw error;
            }

            const statusCode = extractStatusCode(error);
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown Gemini API error';

            // Retry with FALLBACK model on 429 (rate limit), 500 (server error), or 503 (high demand)
            if (
                (model === GEMINI_MODELS.PRO || model === GEMINI_MODELS.FLASH || model === GEMINI_MODELS.FILTER) &&
                (statusCode === 429 || statusCode === 500 || statusCode === 503)
            ) {
                this.logger.warn(
                    `${model} returned ${String(statusCode)}, retrying with ${GEMINI_MODELS.FALLBACK}`,
                );

                try {
                    const fallbackResponse = await this.ai.models.generateContent({
                        model: GEMINI_MODELS.FALLBACK,
                        contents,
                        config,
                    });

                    return this.parseResponse(fallbackResponse, GEMINI_MODELS.FALLBACK);
                } catch (fallbackError: unknown) {
                    const fbMessage =
                        fallbackError instanceof Error
                            ? fallbackError.message
                            : 'Unknown fallback error';
                    throw new ModelError(
                        `Both ${model} and fallback ${GEMINI_MODELS.FALLBACK} failed: ${fbMessage}`,
                    );
                }
            }

            throw new ModelError(`${model} failed: ${errorMessage}`);
        }
    }

    /**
     * Parse SDK response into Elena's response type.
     */
    private parseResponse(
        response: SDKGenerateContentResponse,
        model: GeminiModel,
    ): ElenaGenerateContentResponse {
        if (
            !response.candidates ||
            response.candidates.length === 0 ||
            !response.candidates[0].content
        ) {
            throw new ModelError(
                `Empty response from ${model} — no candidates returned`,
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

        return {
            text: response.text ?? '',
            rawContent: response.candidates[0].content,
            functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
            model,
        };
    }

    /**
     * Generate an embedding vector for the given text.
     * Uses gemini-embedding-001 with outputDimensionality=768.
     */
    async embed(text: string): Promise<number[]> {
        try {
            const response = await this.ai.models.embedContent({
                model: GEMINI_MODELS.EMBEDDING,
                contents: text,
                config: {
                    outputDimensionality: EMBEDDING_DIMENSIONS,
                },
            });

            if (!response.embeddings || response.embeddings.length === 0) {
                throw new ModelError('Empty embedding response — no embeddings returned');
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
