import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { ReplySenderService } from './reply.sender';
import { TelegramMediaService } from './media.service';
import { DmDispatcherService } from './dm.dispatcher';
import { ReactionSenderService } from './reaction.sender';
import { QueueModule } from '../queue/queue.module';
import { PersonasModule } from '../personas/personas.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
    imports: [forwardRef(() => QueueModule), PersonasModule, forwardRef(() => OnboardingModule)],
    controllers: [WebhookController],
    providers: [ReplySenderService, TelegramMediaService, DmDispatcherService, ReactionSenderService],
    exports: [ReplySenderService, TelegramMediaService, DmDispatcherService],
})
export class TelegramModule { }
