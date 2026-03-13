import { Module, forwardRef } from '@nestjs/common';
import { OnboardingDetector } from './detector.service';
import { InterviewerService } from './interviewer.service';
import { ApproverService } from './approver.service';
import { ClaimAdminCommand } from './claim-admin.command';
import { AgentsModule } from '../agents/agents.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
    imports: [AgentsModule, forwardRef(() => TelegramModule)],
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
export class OnboardingModule { }
