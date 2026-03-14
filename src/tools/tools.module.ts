import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { ExecutorService } from './executor.service';
import { GithubFetchTool } from './github-fetch.tool';
import { MemorySearchTool } from './memory-search.tool';
import { DocScraperTool } from './doc-scraper.tool';
import { BountyUpdateTool } from './bounty-update.tool';
import { SendDmTool } from './send-dm.tool';
import { SendReminderTool } from './send-reminder.tool';
import { DraftMessageTool } from './draft-message.tool';
import { RunCodeTool } from './run-code.tool';
import { WebSearchTool } from './web-search.tool';
import { LogMonitorTool } from './log-monitor.tool';
import { DelegateTaskTool } from './delegate-task.tool';
import { MemoryModule } from '../memory/memory.module';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';
import { QueueModule } from '../queue/queue.module';
import { forwardRef } from '@nestjs/common';

@Module({
    imports: [
        MemoryModule,
        PrismaModule,
        forwardRef(() => TelegramModule),
        forwardRef(() => QueueModule),
    ],
    providers: [
        RegistryService,
        ExecutorService,
        GithubFetchTool,
        MemorySearchTool,
        DocScraperTool,
        BountyUpdateTool,
        SendDmTool,
        SendReminderTool,
        DraftMessageTool,
        RunCodeTool,
        WebSearchTool,
        LogMonitorTool,
        DelegateTaskTool
    ],
    exports: [
        RegistryService,
        ExecutorService
    ]
})
export class ToolsModule { }
