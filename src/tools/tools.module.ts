import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { ExecutorService } from './executor.service';
import { GithubFetchTool } from './github-fetch.tool';
import { MemorySearchTool } from './memory-search.tool';
import { DocScraperTool } from './doc-scraper.tool';
import { BountyUpdateTool } from './bounty-update.tool';
import { SendDmTool } from './send-dm.tool';
import { SendReminderTool } from './send-reminder.tool';
import { RunCodeTool } from './run-code.tool';
import { WebSearchTool } from './web-search.tool';
import { LogMonitorTool } from './log-monitor.tool';
import { DelegateTaskTool } from './delegate-task.tool';
import { SaveInterviewTool } from './save-interview.tool';
import { UpdateUserProfileTool } from './update-user-profile.tool';
import { UpdateUserPreferencesTool } from './update-user-preferences.tool';
import { ViewUserProfileTool } from './view-user-profile.tool';
import { ApproveUserTool } from './approve-user.tool';
import { PromptEngineerTool } from './prompt-engineer.tool';
import { GenerateImageTool } from './generate-image.tool';
import { MemoryModule } from '../memory/memory.module';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';
import { QueueModule } from '../queue/queue.module';
import { PersonasModule } from '../personas/personas.module';
import { AuditModule } from '../audit/audit.module';
import { forwardRef } from '@nestjs/common';
import { GeminiModule } from '@app/common';
import { SecretsModule } from '../secrets/secrets.module';

@Module({
  imports: [
    GeminiModule,
    MemoryModule,
    PrismaModule,
    PersonasModule,
    AuditModule,
    forwardRef(() => SecretsModule),
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
    RunCodeTool,
    WebSearchTool,
    LogMonitorTool,
    DelegateTaskTool,
    SaveInterviewTool,
    UpdateUserProfileTool,
    UpdateUserPreferencesTool,
    ViewUserProfileTool,
    ApproveUserTool,
    PromptEngineerTool,
    GenerateImageTool,
  ],
  exports: [RegistryService, ExecutorService, SaveInterviewTool, UpdateUserProfileTool, UpdateUserPreferencesTool, ApproveUserTool],
})
export class ToolsModule {}
