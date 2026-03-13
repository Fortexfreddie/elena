import { Injectable } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

@Injectable()
export class TaskAgent extends BaseAgent {
    constructor(geminiService: GeminiService) {
        super('task', GEMINI_MODELS.FLASH, geminiService);
    }

    protected getRoleInstruction(): string {
        return `You are Elena's Task/Bounty persona. Your job is to manage bounties, issues, and reminders.
You keep the team organized and track who is doing what.`;
    }
}
