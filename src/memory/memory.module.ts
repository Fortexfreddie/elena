import { Module } from '@nestjs/common';
import { HotMemoryService } from './hot.memory.service.js';
import { WarmMemoryService } from './warm.memory.service.js';
import { ColdMemoryService } from './cold.memory.service.js';
import { AssemblerService } from './assembler.service.js';
import { PrismaModule } from '@app/database';
import { GeminiModule, UpstashRedisModule } from '@app/common';

@Module({
    imports: [PrismaModule, GeminiModule, UpstashRedisModule],
    providers: [
        HotMemoryService,
        WarmMemoryService,
        ColdMemoryService,
        AssemblerService
    ],
    exports: [
        HotMemoryService,
        WarmMemoryService,
        ColdMemoryService,
        AssemblerService
    ]
})
export class MemoryModule {}
