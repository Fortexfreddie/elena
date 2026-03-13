import { Injectable, Logger } from '@nestjs/common';
import type { AgentTool } from './base.tool.js';
import { CustomSearchTool } from './custom-search.tool.js';
import type { FunctionDeclaration } from '@google/genai';

/**
 * Tool Registry Service.
 * Collects all injected tools in one place.
 * Agents can retrieve the function declarations from here to pass to Gemini.
 */
@Injectable()
export class RegistryService {
    private readonly logger = new Logger(RegistryService.name);
    private readonly toolsMap = new Map<string, AgentTool>();

    constructor(
        private readonly customSearchTool: CustomSearchTool,
        // As we add more tools, inject them here:
        // private readonly githubTool: GithubTool,
        // private readonly bountyTool: BountyTool,
    ) {
        this.registerTool(this.customSearchTool);
    }

    private registerTool(tool: AgentTool): void {
        if (this.toolsMap.has(tool.name)) {
            this.logger.warn(`Tool ${tool.name} is already registered! Overwriting.`);
        }
        this.toolsMap.set(tool.name, tool);
        this.logger.debug(`Registered tool: ${tool.name}`);
    }

    /**
     * Get the Gemini FunctionDeclaration object for all registered tools.
     */
    getToolDeclarations(): FunctionDeclaration[] {
        return Array.from(this.toolsMap.values()).map(t => t.getDeclaration());
    }

    /**
     * Retrieve a specific tool instance by name.
     */
    getTool(name: string): AgentTool | undefined {
        return this.toolsMap.get(name);
    }
}
