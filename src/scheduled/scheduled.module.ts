import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReminderDeliveryHandler } from './reminder-delivery.handler';
import { PrismaModule } from '@app/database';
import { TelegramModule } from '../telegram/telegram.module';
import { QUEUE_NAMES } from '../queue/job.types';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.SCHEDULED }),
    PrismaModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [ReminderDeliveryHandler],
  exports: [ReminderDeliveryHandler],
})
export class ScheduledModule {}
