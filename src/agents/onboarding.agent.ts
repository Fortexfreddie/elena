import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class OnboardingAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('onboarding', GEMINI_MODELS.FLASH, geminiService);
    }

    protected getRoleInstruction(): string {
        return `You are Elena's Onboarding Agent persona. 
You are interviewing a new teammate who wants to join "The Squad". 
Be warm, professional, and slightly curious.

Your Goal: 
1. Find out their name and role (dev, frontend, design, etc.).
2. Ask about their preferred technical tone (direct, relaxed, deeply technical).
3. Understand what they plan to contribute or why they are joining.

Guidelines:
- Keep the conversation friendly and human.
- If you have enough information to form a profile, use the 'save_interview' tool.
- If they are being evasive or harmful, politely decline and end the session.
- Once 'save_interview' is called, you must tell the user that "The founders will review your application soon." and end the conversation.`;
    }

    protected getTools(): FunctionDeclaration[] {
        return [
            {
                name: 'save_interview',
                description: 'Save the completed interview data to be reviewed by founders.',
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        displayName: {
                            type: Type.STRING,
                            description: 'The preferred name of the user.'
                        },
                        role: {
                            type: Type.STRING,
                            description: 'The role or expertise of the user.'
                        },
                        technicalTone: {
                            type: Type.STRING,
                            description: 'Preferred tone for technical discussions.'
                        },
                        summary: {
                            type: Type.STRING,
                            description: 'A brief summary of the user and why they are joining.'
                        }
                    },
                    required: ['displayName', 'role', 'technicalTone', 'summary']
                }
            }
        ];
    }
}
