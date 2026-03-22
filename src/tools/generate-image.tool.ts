import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { ReplySenderService } from '../telegram/reply.sender';

@Injectable()
export class GenerateImageTool implements AgentTool {
  private readonly logger = new Logger(GenerateImageTool.name);

  name = 'generate_image';
  description =
    'Generate an AI image from a text prompt using Gemini image generation. ' +
    'Sends the generated image directly to the Telegram chat. ' +
    'Use when the user asks to generate, create, or draw an image. ' +
    'For best results, use detailed descriptive prompts. ' +
    'If the user has a vague idea, use prompt_engineer first with ' +
    'targetContext=image_gen to craft a better prompt before calling this tool.';

  argsSchema = z.object({
    prompt: z.string().min(1),
    caption: z.string().optional(),
  });

  requiresConfirmation = false;

  constructor(
    private readonly geminiService: GeminiService,
    @Inject(forwardRef(() => ReplySenderService))
    private readonly replySender: ReplySenderService,
  ) {}

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          prompt: {
            type: Type.STRING,
            description:
              'Detailed text description of the image to generate. ' +
              'Be specific about style, colors, composition, and mood. ' +
              'Example: A dark cyberpunk cityscape with neon blue and purple ' +
              'lighting, rain-soaked streets, cinematic wide shot, hyper-realistic.',
          },
          caption: {
            type: Type.STRING,
            description:
              'Optional caption to send below the image in Telegram. ' +
              'Keep it short and relevant.',
          },
        },
        required: ['prompt'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const prompt = args['prompt'] as string;
    const caption = args['caption'] as string | undefined;
    const chatId = context.parsedMessage.chatId;

    this.logger.log(
      `[IMAGE_GEN] Generating image for chat ${chatId}: ${prompt.slice(0, 80)}...`,
    );

    let imageBuffer: Buffer | null = null;
    let mimeType = 'image/jpeg';
    let source = 'gemini';

    // ATTEMPT 1: Gemini image generation
    try {
      const result = await this.geminiService.generateImage(prompt);
      if (result) {
        imageBuffer = Buffer.from(result.data, 'base64');
        mimeType = result.mimeType;
        this.logger.log(
          `[IMAGE_GEN] Gemini succeeded (${imageBuffer.length} bytes)`,
        );
      } else {
        this.logger.warn(
          '[IMAGE_GEN] Gemini returned null — falling back to Pollinations',
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[IMAGE_GEN] Gemini failed: ${msg} — falling back to Pollinations`,
      );
    }

    // ATTEMPT 2: Pollinations.ai fallback (gen.pollinations.ai)
    if (!imageBuffer) {
      source = 'pollinations';
      const pollinationsKey = process.env['POLLINATIONS_API_KEY'];

      if (!pollinationsKey) {
        this.logger.warn(
          '[IMAGE_GEN] POLLINATIONS_API_KEY not set — cannot use fallback',
        );
        return {
          success: false,
          terminateLoop: true,
          error:
            'Image generation is currently unavailable. ' +
            'Gemini image quota is exhausted and no fallback key is configured. ' +
            'Please try again later.',
        };
      }

      try {
        this.logger.log('[IMAGE_GEN] Trying Pollinations.ai fallback...');

        const encodedPrompt = encodeURIComponent(prompt);
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationsUrl =
          `https://gen.pollinations.ai/image/${encodedPrompt}` +
          `?model=flux&width=1024&height=1024&seed=${seed}&nologo=true`;

        const got = (await import('got')).default;
        const response = await got(pollinationsUrl, {
          responseType: 'buffer',
          timeout: { request: 45000 },
          followRedirect: true,
          headers: {
            Authorization: `Bearer ${pollinationsKey}`,
          },
        });

        if (response.body && response.body.length > 0) {
          // Check if response is JSON error instead of image
          const contentType = response.headers['content-type'] ?? '';
          if (contentType.includes('application/json')) {
            const errorText = response.body.toString('utf8');
            throw new Error(`Pollinations returned error: ${errorText.slice(0, 200)}`);
          }

          imageBuffer = response.body;
          mimeType = 'image/jpeg';
          this.logger.log(
            `[IMAGE_GEN] Pollinations succeeded (${imageBuffer.length} bytes)`,
          );
        } else {
          throw new Error('Pollinations returned empty buffer');
        }
      } catch (pollErr: unknown) {
        const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        this.logger.error(`[IMAGE_GEN] Pollinations also failed: ${msg}`);
        return {
          success: false,
          terminateLoop: true,
          error:
            'Image generation failed on both Gemini and Pollinations. ' +
            'The image service may be temporarily unavailable or quota exhausted. ' +
            'Please try again in a few minutes.',
        };
      }
    }

    // Send image to Telegram
    try {
      await this.replySender.sendPhoto(
        chatId,
        imageBuffer,
        mimeType,
        caption,
        context.parsedMessage.rawUpdate.message?.message_id,
      );

      this.logger.log(
        `[IMAGE_GEN] Image sent to chat ${chatId} via ${source} (${imageBuffer.length} bytes)`,
      );

      return {
        success: true,
        data: {
          message: caption
            ? `Image generated and sent with caption: ${caption}`
            : 'Image generated and sent successfully.',
          source,
          mimeType,
          sizeBytes: imageBuffer.length,
        },
      };
    } catch (sendErr: unknown) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      this.logger.error(
        `[IMAGE_GEN] Failed to send image to Telegram: ${msg}`,
      );
      return {
        success: false,
        terminateLoop: true,
        error: `Image was generated but failed to send to Telegram: ${msg}`,
      };
    }
  }
}
