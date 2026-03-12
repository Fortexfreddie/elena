import { Module } from '@nestjs/common';
import { FilterAgent } from './filter.agent.js';

@Module({
    providers: [FilterAgent],
    exports: [FilterAgent],
})
export class AgentsModule { }
