import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { ReplySenderService } from './reply.sender';
import { TelegramMediaService } from './media.service';
import { DmDispatcherService } from './dm.dispatcher';
import { ReactionSenderService } from './reaction.sender';
import { QueueModule } from '../queue/queue.module';
import { PersonasModule } from '../personas/personas.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SecretsModule } from '../secrets/secrets.module';
import { SafetyModule } from '../safety/safety.module';

import { SecurityAlertService } from './security-alert.service';

@Module({
  imports: [
    forwardRef(() => QueueModule),
    PersonasModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => SecretsModule),
    forwardRef(() => SafetyModule),
  ],
  controllers: [WebhookController],
  providers: [
    ReplySenderService,
    TelegramMediaService,
    DmDispatcherService,
    ReactionSenderService,
    SecurityAlertService,
  ],
  exports: [
    ReplySenderService,
    TelegramMediaService,
    DmDispatcherService,
    SecurityAlertService,
  ],
})
export class TelegramModule {}
