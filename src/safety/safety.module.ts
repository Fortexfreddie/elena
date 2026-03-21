import { Module, forwardRef } from '@nestjs/common';
import { SanitizerService } from './sanitizer.service';
import { MaskerService } from './masker.service';
import { JailbreakDetectorService } from './jailbreak-detector.service';
import { SafetyChecklistService } from './safety-checklist.service';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [
    SanitizerService,
    MaskerService,
    JailbreakDetectorService,
    SafetyChecklistService,
  ],
  exports: [
    SanitizerService,
    MaskerService,
    JailbreakDetectorService,
    SafetyChecklistService,
  ],
})
export class SafetyModule { }