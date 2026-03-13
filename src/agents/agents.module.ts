import { Module } from '@nestjs/common';
import { FilterAgent } from './filter.agent';
import { CoderAgent } from './coder.agent';
import { ReviewerAgent } from './reviewer.agent';
import { ResearcherAgent } from './researcher.agent';
import { BrainstormAgent } from './brainstorm.agent';
import { TaskAgent } from './task.agent';
import { ManagerAgent } from './manager.agent';
import { OnboardingAgent } from './onboarding.agent';

@Module({
    providers: [
        FilterAgent,
        CoderAgent,
        ReviewerAgent,
        ResearcherAgent,
        BrainstormAgent,
        TaskAgent,
        ManagerAgent,
        OnboardingAgent,
    ],
    exports: [
        FilterAgent,
        ManagerAgent,
        OnboardingAgent,
    ],
})
export class AgentsModule { }
