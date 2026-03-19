import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@app/database';
import { ReplySenderService } from '../telegram/reply.sender';
import { DmDispatcherService } from '../telegram/dm.dispatcher';
import { QUEUE_NAMES } from '../queue/job.types';

@Processor(QUEUE_NAMES.SCHEDULED)
export class ReminderDeliveryHandler extends WorkerHost {
  private readonly logger = new Logger(ReminderDeliveryHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly replySender: ReplySenderService,
    private readonly dmDispatcher: DmDispatcherService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'reminder-delivery') return;

    const { reminderId } = job.data as { reminderId: string };
    this.logger.log(`[REMINDER] Processing reminder ${reminderId}`);

    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder) {
      this.logger.warn(`[REMINDER] Reminder ${reminderId} not found`);
      return;
    }

    if (reminder.sent) {
      this.logger.warn(`[REMINDER] Reminder ${reminderId} already sent — skipping`);
      return;
    }

    try {
      if (reminder.targetType === 'dm' && reminder.targetUserId) {
        await this.dmDispatcher.sendDm(
          reminder.targetUserId,
          reminder.reminderMessage,
        );
        this.logger.log(`[REMINDER] Sent DM reminder to ${reminder.targetUserId}`);
      } else {
        await this.replySender.sendReply(
          reminder.chatId,
          reminder.reminderMessage,
        );
        this.logger.log(`[REMINDER] Sent group reminder to chat ${reminder.chatId}`);
      }

      await this.prisma.reminder.update({
        where: { id: reminderId },
        data: { sent: true, sentAt: new Date() },
      });

      this.logger.log(`[REMINDER] Reminder ${reminderId} delivered and marked sent`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[REMINDER] Failed to deliver reminder ${reminderId}: ${msg}`);
      throw error; // Re-throw so BullMQ retries (attempts: 5 configured)
    }
  }
}
