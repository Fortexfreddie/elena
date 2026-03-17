import { Module, forwardRef } from '@nestjs/common';
import { OnboardingDetector } from './detector.service';
import { InterviewerService } from './interviewer.service';
import { ApproverService } from './approver.service';
import { ClaimAdminCommand } from './claim-admin.command';
import { AgentsModule } from '../agents/agents.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PersonasModule } from '../personas/personas.module';

@Module({
  imports: [
    forwardRef(() => AgentsModule),
    forwardRef(() => TelegramModule),
    PersonasModule,
  ],
  providers: [
    OnboardingDetector,
    InterviewerService,
    ApproverService,
    ClaimAdminCommand,
  ],
  exports: [
    OnboardingDetector,
    InterviewerService,
    ApproverService,
    ClaimAdminCommand,
  ],
})
export class OnboardingModule {}
