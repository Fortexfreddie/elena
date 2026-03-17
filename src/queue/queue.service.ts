import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ParsedMessage } from '@app/common/types/telegram.types';
import type { MessageJob } from './job.types.js';
import type { HITLResumeJob } from './job.types.js';
import { QUEUE_NAMES } from './job.types.js';

/**
 * Service for adding jobs to BullMQ queues.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGES)
    private readonly messagesQueue: Queue,
    @InjectQueue(QUEUE_NAMES.HITL)
    private readonly hitlQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SCHEDULED)
    private readonly scheduledQueue: Queue,
  ) {}

  /**
   * Add a scheduled reminder job.
   * @param reminderId The UUID of the reminder in Prisma
   * @param delayMs Milliseconds to wait before firing
   */
  async addReminderJob(reminderId: string, delayMs: number): Promise<void> {
    await this.scheduledQueue.add(
      'reminder-delivery',
      { reminderId },
      {
        delay: delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`Scheduled reminder ${reminderId} for +${delayMs}ms`);
  }

  /**
   * Add a message job to the processing queue.
   * Job ID includes chatId prefix for traceability in dashboards.
   */
  async addMessageJob(parsedMessage: ParsedMessage): Promise<string> {
    const jobData: MessageJob = {
      parsedMessage,
      retryCount: 0,
    };

    const job = await this.messagesQueue.add('process-message', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    const jobId = job.id ?? 'unknown';
    this.logger.log(
      `Added message job ${jobId} for chat ${parsedMessage.chatId}`,
    );
    return jobId;
  }

  /**
   * Add a HITL resume job when user confirms a pending action.
   */
  async addHitlResumeJob(jobId: string, confirmedBy: string): Promise<void> {
    const jobData: HITLResumeJob = {
      action: 'confirm',
      pendingActionKey: `hitl:${jobId}`,
      confirmedBy,
      jobId,
      decryptedSecretsArray: [],
    };

    await this.hitlQueue.add('hitl-resume', jobData, {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`Added HITL confirm job for ${jobId} by ${confirmedBy}`);
  }

  /**
   * Add a HITL cancel job.
   */
  async addHitlCancelJob(jobId: string, cancelledBy: string): Promise<void> {
    const jobData: HITLResumeJob = {
      action: 'cancel',
      pendingActionKey: `hitl:${jobId}`,
      confirmedBy: cancelledBy,
      jobId,
      decryptedSecretsArray: [],
    };

    await this.hitlQueue.add('hitl-resume', jobData, {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`Added HITL cancel job for ${jobId} by ${cancelledBy}`);
  }
}
