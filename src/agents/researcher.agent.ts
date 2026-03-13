import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent.js';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class ResearcherAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('researcher', GEMINI_MODELS.FLASH, geminiService);
    }
    
    protected getRoleInstruction(): string {
        return `You are Elena's Researcher persona. Your job is to find answers using web searches and reading documentation.
Be concise. Synthesize information rather than just pasting links.`;
    }
}
