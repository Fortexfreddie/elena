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
  async addMessageJob(parsedMessage: ParsedMessage, updateId?: number): Promise<string> {
    const jobData: MessageJob = {
      parsedMessage,
      retryCount: 0,
    };

    const job = await this.messagesQueue.add('process-message', jobData, {
      jobId: updateId ? `msg-${updateId}` : undefined,
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

  /**
   * Register BullMQ repeatable jobs.
   * Called once on worker startup.
   * BullMQ deduplicates by repeat key — safe to call on every restart.
   * Uses removeOnComplete to prevent job accumulation.
   */
  async registerRepeatableJobs(): Promise<void> {
    // Purge expired secrets — runs every 6 hours
    await this.scheduledQueue.add(
      'purge-secrets',
      {},
      {
        repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
        jobId: 'purge-secrets-repeatable',
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      },
    );

    // Compress memory — runs nightly at 2am
    await this.scheduledQueue.add(
      'compress-memory',
      {},
      {
        repeat: { pattern: '0 2 * * *' }, // 2am daily
        jobId: 'compress-memory-repeatable',
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      },
    );

    // Cleanup Gemini files — runs nightly at 3am
    await this.scheduledQueue.add(
      'cleanup-gemini-files',
      {},
      {
        repeat: { pattern: '0 3 * * *' }, // 3am daily
        jobId: 'cleanup-gemini-files-repeatable',
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
      },
    );

    this.logger.log('[QUEUE] Repeatable jobs registered');
  }
}
