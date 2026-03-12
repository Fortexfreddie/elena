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
    ) { }

    /**
     * Add a message job to the processing queue.
     * Job ID includes chatId prefix for traceability in dashboards.
     */
    async addMessageJob(parsedMessage: ParsedMessage): Promise<string> {
        const jobData: MessageJob = {
            parsedMessage,
            retryCount: 0,
        };

        const job = await this.messagesQueue.add(
            'process-message',
            jobData,
            {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
            },
        );

        const jobId = job.id ?? 'unknown';
        this.logger.log(
            `Added message job ${jobId} for chat ${parsedMessage.chatId}`,
        );
        return jobId;
    }

    /**
     * Add a HITL resume job when user confirms a pending action.
     * No retries — idempotency is handled via Postgres updateMany.
     */
    async addHitlResumeJob(
        jobId: string,
        confirmedBy: string,
    ): Promise<void> {
        const jobData: HITLResumeJob = {
            pendingActionKey: `hitl:${jobId}`,
            confirmedBy,
            jobId,
            decryptedSecretsArray: [], // Will be rehydrated from Postgres
        };

        await this.hitlQueue.add('hitl-resume', jobData, {
            attempts: 1,
        });

        this.logger.log(
            `Added HITL resume job for ${jobId} confirmed by ${confirmedBy}`,
        );
    }
}
