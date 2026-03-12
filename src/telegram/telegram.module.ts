import { Module, forwardRef } from '@nestjs/common';
import { WebhookController } from './webhook.controller.js';
import { ReplySenderService } from './reply.sender.js';
import { DmDispatcherService } from './dm.dispatcher.js';
import { ReactionSenderService } from './reaction.sender.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
    imports: [forwardRef(() => QueueModule)],
    controllers: [WebhookController],
    providers: [ReplySenderService, DmDispatcherService, ReactionSenderService],
    exports: [ReplySenderService, DmDispatcherService],
})
export class TelegramModule { }
