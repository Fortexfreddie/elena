import type { ParsedMessage } from '@app/common/types/telegram.types';

/**
 * Job data for the elena-messages BullMQ queue.
 */
export interface MessageJob {
    parsedMessage: ParsedMessage;
    retryCount: number;
}

/**
 * Job data for the elena-hitl BullMQ queue.
 */
export interface HITLResumeJob {
    pendingActionKey: string;
    confirmedBy: string;
    jobId: string;
    decryptedSecretsArray: string[];
}

/**
 * Names for BullMQ repeatable jobs.
 */
export enum RepeatableJobName {
    REMINDER_DELIVERY = 'reminder-delivery',
    NIGHTLY_SUMMARIZE = 'nightly-summarize',
    PURGE_SECRETS = 'purge-secrets',
    COMPRESS_MEMORY = 'compress-memory',
    CLEANUP_GEMINI_FILES = 'cleanup-gemini-files',
}

/**
 * BullMQ queue name constants.
 */
export const QUEUE_NAMES = {
    MESSAGES: 'elena-messages',
    HITL: 'elena-hitl',
    SCHEDULED: 'elena-scheduled',
} as const;
