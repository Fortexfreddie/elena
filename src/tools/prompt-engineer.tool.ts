import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class PromptEngineerTool implements AgentTool {
  private readonly logger = new Logger(PromptEngineerTool.name);

  name = 'prompt_engineer';
  description =
    'Transforms a vague idea or rough description into a detailed, ' +
    'structured prompt ready to use with an AI tool or system. ' +
    'Returns the polished prompt as text — does NOT execute it. ' +
    'Use when the user asks to generate a prompt, improve a prompt, ' +
    'or wants help phrasing a request for Gravity, image generation, ' +
    'research, or any AI system.';

  argsSchema = z.object({
    vagueInput: z.string().min(1),
    targetContext: z.enum([
      'gravity',
      'image_gen',
      'research',
      'agent_system_prompt',
      'general',
    ]),
    outputFormat: z.enum(['detailed', 'concise']).optional(),
  });

  requiresConfirmation = false;

  constructor(private readonly geminiService: GeminiService) {}

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          vagueInput: {
            type: Type.STRING,
            description:
              'The rough idea, vague description, or brief that needs to be expanded into a detailed prompt.',
          },
          targetContext: {
            type: Type.STRING,
            enum: [
              'gravity',
              'image_gen',
              'research',
              'agent_system_prompt',
              'general',
            ],
            description:
              'gravity = prompt for Gravity/Claude code generation. ' +
              'image_gen = prompt for AI image generation (Midjourney/Stable Diffusion style). ' +
              'research = structured research brief. ' +
              'agent_system_prompt = system prompt for an AI agent. ' +
              'general = general purpose prompt improvement.',
          },
          outputFormat: {
            type: Type.STRING,
            enum: ['detailed', 'concise'],
            description:
              'detailed = full structured prompt with context, constraints, and examples. ' +
              'concise = tight focused prompt, no fluff. Defaults to detailed.',
          },
        },
        required: ['vagueInput', 'targetContext'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const vagueInput = args['vagueInput'] as string;
    const targetContext = args['targetContext'] as string;
    const outputFormat = (args['outputFormat'] as string) ?? 'detailed';

    const contextInstructions: Record<string, string> = {
      gravity: `You are an expert at writing prompts for Gravity (an AI coding assistant powered by Gemini).
Gravity works best with:
- Clear file paths and exact function/class names to modify
- Explicit before/after examples when changing existing code
- Step-by-step numbered changes
- Verification steps (what to run, what output to expect)
- Attached file references
Transform the input into a Gravity-ready engineering prompt.`,

      image_gen: `You are an expert at writing prompts for AI image generation models.
Great image prompts include:
- Subject description (who/what)
- Art style (photorealistic, digital art, oil painting, etc.)
- Lighting and mood
- Camera angle or perspective
- Color palette
- Negative prompts (what to avoid)
Transform the input into a detailed image generation prompt.`,

      research: `You are an expert at writing structured research briefs.
Great research prompts include:
- Specific question to answer
- Scope and boundaries
- Required sources or source types
- Output format requested
- Time constraints (e.g. last 6 months only)
Transform the input into a structured research brief.`,

      agent_system_prompt: `You are an expert at writing system prompts for AI agents.
Great system prompts include:
- Clear identity and role definition
- Specific capabilities and limitations
- Behavioral rules and tone guidelines
- Example inputs and outputs
- Edge case handling instructions
Transform the input into a complete agent system prompt.`,

      general: `You are an expert prompt engineer.
Transform the vague input into a clear, specific, and effective prompt
that will get the best results from any AI system.
Focus on: clarity, specificity, context, and desired output format.`,
    };

    const systemInstruction =
      contextInstructions[targetContext] ?? contextInstructions['general'];

    const userMessage =
      outputFormat === 'concise'
        ? `Transform this into a concise, focused prompt. No fluff:\n\n${vagueInput}`
        : `Transform this into a detailed, structured prompt with full context and constraints:\n\n${vagueInput}`;

    try {
      const response = await this.geminiService.generateContent(
        GEMINI_MODELS.FLASH,
        [{ role: 'user', parts: [{ text: userMessage }] }],
        { systemInstruction },
      );

      const generatedPrompt = response.text?.trim();

      if (!generatedPrompt) {
        return {
          success: false,
          error: 'Prompt generation returned empty result.',
        };
      }

      this.logger.log(
        `[PROMPT_ENGINEER] Generated ${targetContext} prompt (${outputFormat}) from: ${vagueInput.slice(0, 50)}...`,
      );

      return {
        success: true,
        data: {
          generatedPrompt,
          targetContext,
          outputFormat,
          instruction:
            'This prompt is ready to use. Copy it and paste it into your target AI tool.',
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Prompt engineer failed: ${msg}`);
      return { success: false, error: `Prompt generation failed: ${msg}` };
    }
  }
}
