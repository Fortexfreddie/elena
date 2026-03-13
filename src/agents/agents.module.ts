import { Module } from '@nestjs/common';
import { FilterAgent } from './filter.agent.js';
import { CoderAgent } from './coder.agent.js';
import { ReviewerAgent } from './reviewer.agent.js';
import { ResearcherAgent } from './researcher.agent.js';
import { BrainstormAgent } from './brainstorm.agent.js';
import { TaskAgent } from './task.agent.js';
import { ManagerAgent } from './manager.agent.js';

@Module({
    providers: [
        FilterAgent,
        CoderAgent,
        ReviewerAgent,
        ResearcherAgent,
        BrainstormAgent,
        TaskAgent,
        ManagerAgent
    ],
    exports: [
        FilterAgent,
        ManagerAgent
    ],
})
export class AgentsModule { }
