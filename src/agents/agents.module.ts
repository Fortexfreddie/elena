import { Module, forwardRef } from '@nestjs/common';
import { FilterAgent } from './filter.agent';
import { CoderAgent } from './coder.agent';
import { ReviewerAgent } from './reviewer.agent';
import { ResearcherAgent } from './researcher.agent';
import { BrainstormAgent } from './brainstorm.agent';
import { TaskAgent } from './task.agent';
import { ManagerAgent } from './manager.agent';
import { OnboardingAgent } from './onboarding.agent';
import { PersonasInjector } from './personas.injector';
import { ToolsModule } from '../tools/tools.module';

@Module({
    imports: [forwardRef(() => ToolsModule)],
    providers: [
        FilterAgent,
        CoderAgent,
        ReviewerAgent,
        ResearcherAgent,
        BrainstormAgent,
        TaskAgent,
        ManagerAgent,
        OnboardingAgent,
        PersonasInjector
    ],
    exports: [
        FilterAgent,
        ManagerAgent,
        OnboardingAgent,
        PersonasInjector
    ],
})
export class AgentsModule { }
