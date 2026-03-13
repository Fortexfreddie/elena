import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service.js';
import { ExecutorService } from './executor.service.js';
import { CustomSearchTool } from './custom-search.tool.js';

@Module({
    providers: [
        RegistryService,
        ExecutorService,
        CustomSearchTool
    ],
    exports: [
        RegistryService,
        ExecutorService
    ]
})
export class ToolsModule {}
