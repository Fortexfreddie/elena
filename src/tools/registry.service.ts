import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import type { AgentTool } from './base.tool';
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
import type { FunctionDeclaration } from '@google/genai';

/**
 * Tool Registry Service.
 * Collects all injected tools in one place.
 * Agents can retrieve the function declarations from here to pass to Gemini.
 */
@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);
  private readonly toolsMap = new Map<string, AgentTool>();

  constructor(
    private readonly githubFetchTool: GithubFetchTool,
    private readonly memorySearchTool: MemorySearchTool,
    private readonly docScraperTool: DocScraperTool,
    private readonly bountyUpdateTool: BountyUpdateTool,
    @Inject(forwardRef(() => SendDmTool))
    private readonly sendDmTool: SendDmTool,
    @Inject(forwardRef(() => SendReminderTool))
    private readonly sendReminderTool: SendReminderTool,
    private readonly runCodeTool: RunCodeTool,
    private readonly webSearchTool: WebSearchTool,
    private readonly logMonitorTool: LogMonitorTool,
    private readonly delegateTaskTool: DelegateTaskTool,
    private readonly saveInterview: SaveInterviewTool,
    private readonly updateUserProfile: UpdateUserProfileTool,
    private readonly updateUserPreferences: UpdateUserPreferencesTool,
    private readonly viewUserProfile: ViewUserProfileTool,
    private readonly approveUser: ApproveUserTool,
    private readonly promptEngineerTool: PromptEngineerTool,
    @Inject(forwardRef(() => GenerateImageTool))
    private readonly generateImageTool: GenerateImageTool,
  ) {}


  onModuleInit() {
    this.registerTool(this.githubFetchTool);
    this.registerTool(this.memorySearchTool);
    this.registerTool(this.docScraperTool);
    this.registerTool(this.bountyUpdateTool);
    this.registerTool(this.sendDmTool);
    this.registerTool(this.sendReminderTool);
    this.registerTool(this.runCodeTool);
    this.registerTool(this.webSearchTool);
    this.registerTool(this.logMonitorTool);
    this.registerTool(this.delegateTaskTool);
    this.registerTool(this.saveInterview);
    this.registerTool(this.updateUserProfile);
    this.registerTool(this.updateUserPreferences);
    this.registerTool(this.viewUserProfile);
    this.registerTool(this.approveUser);
    this.registerTool(this.promptEngineerTool);
    this.registerTool(this.generateImageTool);
  }


  private registerTool(tool: AgentTool): void {
    if (!tool) {
      this.logger.warn('Attempted to register a null or undefined tool');
      return;
    }
    if (!tool.name) {
      this.logger.warn(
        `Tool of type ${tool.constructor.name} has no name defined`,
      );
      return;
    }
    if (this.toolsMap.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} is already registered! Overwriting.`);
    }
    this.toolsMap.set(tool.name, tool);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Get the Gemini FunctionDeclaration object for registered tools.
   * @param allowedTools Optional array of tool names to filter by.
   */
  getToolDeclarations(allowedTools?: string[]): FunctionDeclaration[] {
    let tools = Array.from(this.toolsMap.values());
    if (allowedTools && allowedTools.length > 0) {
      tools = tools.filter((t) => allowedTools.includes(t.name));
    }
    return tools.map((t) => t.getDeclaration());
  }

  /**
   * Retrieve a specific tool instance by name.
   */
  getTool(name: string): AgentTool | undefined {
    return this.toolsMap.get(name);
  }
}
