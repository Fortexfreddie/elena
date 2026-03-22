import { Module } from '@nestjs/common';
import { AuditLoggerService } from './audit-logger.service';
import { LangfuseService } from './langfuse.service';
import { PrismaModule } from '@app/database';
import { SafetyModule } from '../safety/safety.module';

@Module({
  imports: [PrismaModule, SafetyModule],
  providers: [AuditLoggerService, LangfuseService],
  exports: [AuditLoggerService, LangfuseService],
})
export class AuditModule {}
