import { Injectable, Logger } from '@nestjs/common';
import { HotMemoryService } from './hot.memory.service.js';
import { WarmMemoryService } from './warm.memory.service.js';
import { ColdMemoryService } from './cold.memory.service.js';
import type { AssembledContext, WarmResult, BountyInfo } from '@app/common/types/agent.types';

@Injectable()
export class AssemblerService {
    private readonly logger = new Logger(AssemblerService.name);

    constructor(
        private readonly hotMemory: HotMemoryService,
        private readonly warmMemory: WarmMemoryService,
        private readonly coldMemory: ColdMemoryService
    ) {}

    /**
     * Combines all three memory tiers into a single AssembledContext object for agents.
     */
    async assemble(chatId: string, telegramId: string): Promise<AssembledContext> {
        const startTime = Date.now();
        
        // 1. Fetch Hot and Cold memory in parallel
        const [hotMessages, userProfile] = await Promise.all([
            this.hotMemory.getHistory(chatId),
            this.coldMemory.getUserProfile(telegramId)
        ]);

        // 2. Sort hot messages by telegramDate and updateId sequentially
        hotMessages.sort((a, b) => {
            if (a.telegramDate === b.telegramDate) {
                return a.updateId - b.updateId;
            }
            return a.telegramDate - b.telegramDate;
        });

        // 3. Fetch active bounties if user profile exists
        let activeBounties: BountyInfo[] = [];
        if (userProfile) {
            activeBounties = await this.coldMemory.getActiveBounties(userProfile.id);
        }

        // 4. Extract last 3 hot messages for semantic warm memory search
        let warmResults: WarmResult[] = [];
        if (hotMessages.length > 0 && userProfile) {
            const last3 = hotMessages.slice(-3).map(m => `${m.role}: ${m.text}`).join('\n');
            if (last3.trim().length > 0) {
                warmResults = await this.warmMemory.search(last3, userProfile.id);
            }
        }

        this.logger.debug(`Context assembled in ${Date.now() - startTime}ms`);

        return {
            hotMessages,
            userProfile,
            activeBounties,
            warmResults
        };
    }
}
