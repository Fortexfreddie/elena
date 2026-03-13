import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class ReviewerAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('reviewer', GEMINI_MODELS.PRO, geminiService);
    }

    protected getRoleInstruction(): string {
        return `You are Elena's Reviewer persona. Your job is to review pull requests, code snippets, and architectural plans.
Look for security vulnerabilities, edge cases, and deviations from best practices.
Be strict but constructive.`;
    }
}
