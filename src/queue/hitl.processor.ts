import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, HITLResumeJob } from './job.types';
import { RegistryService } from '../tools/registry.service';
import { ReplySenderService } from '../telegram/reply.sender';
import { UpstashRedisService, escapeMarkdownV2 } from '@app/common';
import { AgentContext } from '@app/common/types/agent.types';

@Processor(QUEUE_NAMES.HITL, {
    concurrency: 5,
    lockDuration: 30000,
})
export class HitlProcessor extends WorkerHost {
    private readonly logger = new Logger(HitlProcessor.name);

    constructor(
        @Inject(forwardRef(() => RegistryService))
        private readonly registry: RegistryService,
        @Inject(forwardRef(() => ReplySenderService))
        private readonly replySender: ReplySenderService,
        private readonly redisService: UpstashRedisService,
    ) {
        super();
    }

    async process(job: Job<HITLResumeJob>): Promise<void> {
        const { action, jobId, pendingActionKey, confirmedBy } = job.data;
        const claimKey = `hitl:claim:${jobId}`;

        this.logger.log(`Processing HITL ${action} for job ${jobId}`);

        try {
            // Atomic claim to prevent race conditions (double click)
            const isClaimed = await this.redisService.client.set(claimKey, '1', {
                nx: true,
                ex: 60,
            });

            if (!isClaimed) {
                this.logger.warn(`[EXECUTION_TRACE] HITL job ${jobId} already claimed or processed.`);
                return;
            }

            if (action === 'cancel') {
                await this.redisService.client.del(pendingActionKey);
                await this.replySender.sendReply(
                    jobId.split(':')[0], // We'll store jobId as "chatId:random"
                    '❌ Action cancelled.',
                );
                return;
            }

            // Fetch pending call from Redis
            const raw = await this.redisService.client.get(pendingActionKey);
            if (!raw) {
                this.logger.warn(`HITL key ${pendingActionKey} expired or not found.`);
                // Send expiration message to user
                // We need the chatId. If we store chatId in the key or job data...
                // Let's assume jobId contains info or we fetch it.
                // Best practice: store chatId in job data too or jobId = "chatId:nonce"
                // Best practice: store chatId in job data too or jobId = "chatId:nonce"
                const chatId = jobId.includes(':') ? jobId.split(':')[0] : null;
                if (!chatId) {
                    this.logger.error(`Invalid jobId format during expiry handling: ${jobId}`);
                    return;
                }
                await this.replySender.sendReply(chatId, '⚠️ This confirmation request has expired (5m limit).');
                return;
            }

            const chatId = jobId.includes(':') ? jobId.split(':')[0] : 'unknown';

            let pending: unknown;
            try {
                pending = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (err) {
                this.logger.error(`HITL payload corrupted for jobId ${jobId} — cannot parse JSON`);
                if (chatId !== 'unknown') {
                    await this.replySender.sendReply(
                        chatId,
                        '⚠️ This action could not be resumed — the request data was corrupted.',
                    ).catch(() => {});
                }
                return;
            }

            if (
                typeof pending !== 'object' ||
                pending === null ||
                !('toolName' in pending) ||
                !('args' in pending) ||
                !('context' in pending)
            ) {
                this.logger.error(`HITL payload has unexpected shape for jobId ${jobId}`);
                if (chatId !== 'unknown') {
                    await this.replySender.sendReply(
                        chatId,
                        '⚠️ This action could not be resumed — the request data was invalid.',
                    ).catch(() => {});
                }
                return;
            }

            const { toolName, args, context } = pending as {
                toolName: string;
                args: Record<string, unknown>;
                context: AgentContext & { decryptedSecretsArray?: string[] };
            };

            // Rehydrate Set from serialized array (JSON.stringify(Set) produces {})
            context.decryptedSecretsSet = new Set(context.decryptedSecretsArray ?? []);
            delete (context as any).decryptedSecretsArray;

            const tool = this.registry.getTool(toolName);
            if (!tool) {
                this.logger.error(`Tool ${toolName} not found during HITL resume.`);
                return;
            }

            // Execute the tool directly
            this.logger.log(`Resuming tool execution: ${toolName}`);
            const result = await tool.execute(args, context);

            // Send results back to the original chat
            const resultText = result.success
                ? `✅ *Action Confirmed*\n\nResult: ${JSON.stringify(result.data, null, 2)}`
                : `❌ *Action Failed*\n\nError: ${result.error}`;

            await this.replySender.sendReply(context.parsedMessage.chatId, resultText);

            // Cleanup
            await this.redisService.client.del(pendingActionKey);
            this.logger.log(`[EXECUTION_TRACE] HITL ${jobId} completed successfully.`);

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`HITL processing failed for ${jobId}: ${msg}`);
            // Release claim on error so it can be retried if needed (though attempts=1)
            await this.redisService.client.del(claimKey);
        }
    }
}
