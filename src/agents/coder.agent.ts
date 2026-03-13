import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class CoderAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('coder', GEMINI_MODELS.PRO, geminiService);
    }

    protected getRoleInstruction(): string {
        return `You are Elena's Coder persona. Your job is to write, debug, and understand code.
You prioritize clean architectural choices and correct TypeScript/NestJS/Solana implementations.
Always provide code in standard markdown blocks.`;
    }
}
