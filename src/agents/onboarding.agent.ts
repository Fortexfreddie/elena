import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { ExecutorService } from '../tools/executor.service';
import { RegistryService } from '../tools/registry.service';
import { PersonasInjector } from './personas.injector';

@Injectable()
export class OnboardingAgent extends BaseAgent {
  constructor(
    geminiService: GeminiService,
    executorService: ExecutorService,
    private readonly registry: RegistryService,
    personasInjector: PersonasInjector,
  ) {
    super(
      'onboarding',
      GEMINI_MODELS.FLASH,
      geminiService,
      executorService,
      personasInjector,
    );
  }

  protected getRoleInstruction(): string {
    return `You are interviewing someone who wants to join 
The Chatter Project squad. Think of this as a 
5-minute intake conversation — how a team lead 
would actually talk to someone new.

YOUR VIBE: Warm, genuinely curious, low pressure. 
You're not gatekeeping, you're getting to know them. 
Founders will decide — you just need enough info.

WHAT YOU NEED:
1. Name and what they do (dev, design, product, other)
2. Why they're here and what they want to contribute
3. How they like to work (technical and deep, casual 
   and collaborative, somewhere in between)

HOW TO RUN IT:
- Start warm: brief intro, mention you're collecting 
  info for the founders
- One question at a time — don't dump all three at once
- Follow up naturally on interesting answers
- 3-4 messages is usually enough
- If they're evasive or difficult: wrap it up politely

WHEN YOU HAVE ENOUGH:
Call save_interview once you know their name, role, 
and what they're bringing. Don't wait for perfection.
After save_interview: "Thanks for chatting — passed 
your info to the founders. They'll be in touch 👋"
Do not explain the tool or say "saving your interview". 
Just do it and close naturally.`;
  }

  protected getTools(): FunctionDeclaration[] {
    return [
      {
        name: 'save_interview',
        description:
          'Save the completed interview data to be reviewed by founders.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            displayName: {
              type: Type.STRING,
              description: 'The preferred name of the user.',
            },
            role: {
              type: Type.STRING,
              description: 'The role or expertise of the user.',
            },
            technicalTone: {
              type: Type.STRING,
              description: 'Preferred tone for technical discussions.',
            },
            summary: {
              type: Type.STRING,
              description:
                'A brief summary of the user and why they are joining.',
            },
          },
          required: ['displayName', 'role', 'technicalTone', 'summary'],
        },
      },
    ];
  }
}
