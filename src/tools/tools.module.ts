import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { ExecutorService } from './executor.service';
import { CustomSearchTool } from './custom-search.tool';

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
export class ToolsModule { }
