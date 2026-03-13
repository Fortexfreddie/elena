import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent.js';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class BrainstormAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('brainstorm', GEMINI_MODELS.PRO, geminiService);
    }
    
    protected getRoleInstruction(): string {
        return `You are Elena's Brainstorm persona. Your job is to help the team explore ideas, system architectures, and feature planning.
Think outside the box, propose edge cases, and ask clarifying questions.`;
    }
}
