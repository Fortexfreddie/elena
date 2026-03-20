import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { TelegramSecretGuard } from './guards/telegram-secret.guard';
import { parseMessage } from './message.parser';
import { shouldProcess } from './heuristic-gate';
import { ReactionSenderService } from './reaction.sender';
import { ReplySenderService } from './reply.sender';
import { QueueService } from '../queue/queue.service';
import { ProfileBuilder } from '../personas/profile-builder.service';
import { PrismaService } from '@app/database';
import { ClaimAdminCommand } from '../onboarding/claim-admin.command';
import type { TelegramUpdate, ParsedMessage } from '@app/common/types/telegram.types';
import { UpstashRedisService, escapeHtml, escapeMarkdownV2 } from '@app/common';

/**
 * Webhook controller for incoming Telegram updates.
 *
 * Pipeline:
 *   0. update_id idempotency gate (FIRST — atomic SETNX)
 *   1. TelegramSecretGuard (401 if wrong header)
 *   2. Check /confirm_ or /cancel_ prefix → HITL resume
 *   3. message.parser.ts → ParsedMessage
 *   4. Stage 1 heuristic gate (zero cost)
 *   5. reaction.sender (thinking emoji)
 *   6. QueueService.addMessageJob
 *   7. return { ok: true }
 *
 * Grammy is NOT called here. bot.handleUpdate() is NEVER called.
 * try/catch wraps the pipeline — on failure, redis.del releases the update_id lock.
 */
@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private botId: number | null = null;

  constructor(
    private readonly reactionSender: ReactionSenderService,
    private readonly replySender: ReplySenderService,
    private readonly queueService: QueueService,
    private readonly redisService: UpstashRedisService,
    private readonly profileBuilder: ProfileBuilder,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ClaimAdminCommand))
    private readonly claimAdmin: ClaimAdminCommand,
  ) {}

  @Post('/webhook')
  @UseGuards(TelegramSecretGuard)
  @HttpCode(200)
  async handleWebhook(
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: boolean }> {
    const updateId = update.update_id;

    // Step 0: Atomic update_id idempotency gate
    // SETNX with TTL in a single command — no race condition
    const isNew = await this.redisService.client.set(
      `update:${String(updateId)}`,
      '1',
      {
        nx: true,
        ex: 3600,
      },
    );

    if (!isNew) {
      // Duplicate — Telegram retry. Drop silently.
      return { ok: true };
    }

    let parsed: ParsedMessage | null = null;
    try {
      // Step 0.5: Check for Callback Queries (Approval Flow)
      if (update.callback_query) {
        const callbackData = update.callback_query.data;
        const fromId = String(update.callback_query.from.id);
        const chatId = update.callback_query.message?.chat.id;

        if (!chatId) {
          this.logger.warn(
            `Received callback_query from ${fromId} without chat context — dropping`,
          );
          return { ok: true };
        }

        if (
          callbackData &&
          (callbackData.startsWith('approve_') ||
            callbackData.startsWith('deny_'))
        ) {
          this.logger.log(
            `[APPROVAL_TRACE] Founder ${fromId} clicked approval button: ${callbackData}`,
          );
          // 1. Verify founder or admin status (M-10)
          const user = await this.prisma.user.findUnique({
            where: { telegramId: fromId },
            select: { isFoundingMember: true, role: true },
          });

          if (!user || (!user.isFoundingMember && !['admin', 'superadmin'].includes(user.role))) {
            this.logger.warn(
              `Unauthorized user ${fromId} tried to approve/deny onboarding.`,
            );
            return { ok: true };
          }

          // 2. Parse data: "approve_sessionId|displayName"
          const [actionWithId, displayName] = callbackData.split('|');

          if (actionWithId.startsWith('approve_')) {
            const sessionId = actionWithId.replace('approve_', '');
            await this.profileBuilder.finalize(sessionId);
            await this.replySender.sendReply(
              String(chatId),
              `✅ Approved: *${escapeMarkdownV2(displayName)}* is now part of the squad.`,
              undefined,
              'MarkdownV2',
              false,
            );
          } else if (actionWithId.startsWith('deny_')) {
            const sessionId = actionWithId.replace('deny_', '');
            await this.profileBuilder.reject(sessionId);
            await this.replySender.sendReply(
              String(chatId),
              `❌ Denied: *${escapeMarkdownV2(displayName)}* request rejected.`,
              undefined,
              'MarkdownV2',
              false,
            );
          }

          return { ok: true };
        }
      }
      // Check for HITL commands before parsing
      const messageText = update.message?.text;
      if (messageText) {
        const lower = messageText.toLowerCase();

        // Hardened HITL command parsing (Phase 4.1)
        // Matches /confirm_jobId or /cancel_jobId, stops at space or @mention
        const hitlMatch = lower.match(/^\/(confirm|cancel)_([^\s@]+)/);
        if (hitlMatch) {
          const action = hitlMatch[1];
          const jobId = hitlMatch[2];
          const processedBy = String(update.message?.from?.id ?? 'unknown');

          // C-2: Security - Verify sender is admin/superadmin OR the original requester before allowing HITL actions
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: processedBy },
            select: { role: true },
          });

          const pendingActionKey = `hitl:${jobId}`;
          const rawPending = await this.redisService.client.get(pendingActionKey);
          
          let requesterId = 'unknown';
          if (rawPending && typeof rawPending === 'string') {
            try {
              const pendingData = JSON.parse(rawPending);
              requesterId = pendingData.requesterId || 'unknown';
            } catch (err) {
              this.logger.warn(`Failed to parse pending action data for jobId ${jobId}`);
            }
          }

          if (!rawPending) {
            this.logger.warn(
              `[HITL] Cannot verify requesterId for jobId ${jobId} — Redis key missing or expired. Falling back to admin-only confirmation.`
            );
          }

          if (
            !sender ||
            (!['admin', 'superadmin'].includes(sender.role) && processedBy !== requesterId)
          ) {
            this.logger.warn(
              `[SECURITY] Unauthorized user ${processedBy} tried to ${action} HITL job ${jobId}`,
            );
            return { ok: true }; // Silent drop
          }

          if (action === 'confirm') {
            await this.queueService.addHitlResumeJob(jobId, processedBy);
          } else {
            await this.queueService.addHitlCancelJob(jobId, processedBy);
          }
          return { ok: true };
        }

        if (lower === '/claim-admin') {
          const from = update.message?.from;
          if (from) {
            const result = await this.claimAdmin.execute(
              String(from.id),
              from.first_name,
              from.username,
            );
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              result,
              undefined,
              'MarkdownV2',
            );
          }
          return { ok: true };
        }
        if (lower === '/clear') {
          // C-3: Add admin-only role check to /clear command
          const senderId = String(update.message?.from?.id);
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { role: true },
          });

          if (!sender || !['admin', 'superadmin'].includes(sender.role)) {
            this.logger.warn(
              `[SECURITY] Non-admin ${senderId} tried to use /clear`,
            );
            return { ok: true }; // Silent drop
          }

          const chatId = String(update.message?.chat.id);
          await this.redisService.client.del(`hot:${chatId}`);
          await this.replySender.sendReply(
            chatId,
            "🗑️ Elena's hot memory cleared. Context reset to Day 1.",
            undefined,
            null,
          );
          return { ok: true };
        }
      }

      // Retrieve eagerly-resolved bot ID
      if (this.botId === null) {
        this.botId = this.replySender.getBotId();
      }

      // Step 2: Parse the update
      parsed = parseMessage(update, this.botId);
      if (!parsed) {
        // Not a processable message (e.g., channel post, bot message)
        return { ok: true };
      }

      // --- SECURITY GUARD: Group-First Requirement (Phase 3.13) ---
      const sender = await this.prisma.user.findUnique({
        where: { telegramId: parsed.userId },
        select: { id: true, role: true },
      });

      if (!parsed.isDm) {
        // In Groups: Automatically register unknown participants as Guests (Atomic Upsert)
        const from = update.message?.from || update.callback_query?.from;
        await this.prisma.user.upsert({
          where: { telegramId: parsed.userId },
          update: {
            username: from?.username || null,
          },
          create: {
            telegramId: parsed.userId,
            displayName: from?.first_name || 'Anonymous',
            username: from?.username || null,
            role: 'guest',
          },
        });
      } else {
        // In DMs: If user is unknown (not in DB), ignore them completely
        if (!sender) {
          this.logger.warn(
            `[SECURITY_TRACE] Ignoring DM from unknown user ${parsed.userId}. (Group-First Guard ACTIVE)`,
          );

          // M-9: Removed redundant Stranger Alert to prevent duplication with GUEST ACTIVITY ALERT


          return { ok: true };
        }
      }

      // Step 3: Stage 1 heuristic gate (zero cost)
      if (!shouldProcess(parsed)) {
        return { ok: true };
      }

      // Step 4: Rate limiting (Phase 2+)
      // TODO-PHASE2: RateLimiterService check here

      // Step 5: Send thinking reaction
      if (parsed.rawUpdate.message) {
        await this.reactionSender.sendThinkingReaction(
          parsed.chatId,
          parsed.rawUpdate.message.message_id,
        );
      }

      // Step 6: Push to BullMQ queue
      await this.queueService.addMessageJob(parsed, updateId);

      return { ok: true };
    } catch (error: unknown) {
      // Release the update_id lock so Telegram's retry can get through
      await this.redisService.client.del(`update:${String(updateId)}`);

      this.logger.error({
        msg: 'Webhook pipeline error',
        error,
        updateId,
        parsedUserId: parsed?.userId ?? 'unparsed',
      });

      // Return 200 to prevent Telegram from spamming retries
      return { ok: true };
    }
  }
}
