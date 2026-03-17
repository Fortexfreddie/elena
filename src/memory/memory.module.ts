import { Module } from '@nestjs/common';
import { HotMemoryService } from './hot.memory.service';
import { WarmMemoryService } from './warm.memory.service';
import { ColdMemoryService } from './cold.memory.service';
import { AssemblerService } from './assembler.service';
import { PrismaModule } from '@app/database';
import { GeminiModule, UpstashRedisModule } from '@app/common';

@Module({
  imports: [PrismaModule, GeminiModule, UpstashRedisModule],
  providers: [
    HotMemoryService,
    WarmMemoryService,
    ColdMemoryService,
    AssemblerService,
  ],
  exports: [
    HotMemoryService,
    WarmMemoryService,
    ColdMemoryService,
    AssemblerService,
  ],
})
export class MemoryModule {}
