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
import { VaultService } from '../secrets/vault.service';
import { SecurityAlertService } from './security-alert.service';
import { JailbreakDetectorService } from '../safety/jailbreak-detector.service';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { RateLimiterService } from './rate-limiter.service';

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
    private readonly vaultService: VaultService,
    private readonly securityAlert: SecurityAlertService,
    private readonly jailbreakDetector: JailbreakDetectorService,
    private readonly auditLogger: AuditLoggerService,
    private readonly rateLimiter: RateLimiterService,
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

        if (lower === '/roles') {
          const rolesText = `🛡️ *Role Capabilities & Limits*\n\n`
            + `*Superadmin (Founder)*\n`
            + `• Manage anyone (incl. Admins)\n`
            + `• Toggle system broadcasts (\`/morning\`)\n`
            + `• Halt system, execute code, modify onboarding\n\n`
            
            + `*Admins*\n`
            + `• Reset memory (\`/clear\`)\n`
            + `• Manage Members & Guests\n`
            + `• Execute secure HITL actions & run monitors\n\n`
            
            + `*Members*\n`
            + `• Interact with Elena naturally\n`
            + `• Submit PR reviews, use the secret vault\n`
            + `• Schedule DB reminders\n`
            + `• _Cannot_ modify system settings or other users\n\n`
            
            + `*Guests*\n`
            + `• Sandboxed holding pattern\n`
            + `• Elena drops messages without internal context until an Admin approves them via DM.\n`;

          await this.replySender.sendReply(
            String(update.message?.chat.id),
            rolesText,
            undefined,
            'MarkdownV2',
          );
          return { ok: true };
        }

        if (lower === '/manual') {
          const senderId = String(update.message?.from?.id);
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { role: true, displayName: true, onboardingStatus: true, personaJson: true },
          });
 
          const isSuper = sender?.role === 'superadmin';
          const isAdmin = sender?.role === 'admin' || isSuper;
          const isDm = update.message?.chat.type === 'private';
 
          let manual = '📖 *Elena Command & Role Manual*\n\n';

          if (sender) {
            const persona = sender.personaJson as Record<string, string> | null;
            const tone = persona?.technicalTone?.trim() ? persona.technicalTone.trim() : 'None specified (General)';
            const dispName = sender.displayName || 'Anonymous';
            const roleStr = sender.role ? sender.role.charAt(0).toUpperCase() + sender.role.slice(1) : 'Unknown';
            const statusStr = sender.onboardingStatus ? sender.onboardingStatus.charAt(0).toUpperCase() + sender.onboardingStatus.slice(1) : 'Unknown';
            
            manual += '👤 *Your Profile*\n';
            manual += `• *Name:* ${dispName}\n`;
            manual += `• *Role:* ${roleStr}\n`;
            manual += `• *Status:* ${statusStr}\n`;
            manual += `• *Preference:* ${tone}\n\n`;
          } else {
            manual += '👤 *Your Profile*\n• *Role:* Unknown (Not registered)\n\n';
          }

          manual += '🛠️ *Commands*\n';
          manual += '• `/roles` — See what each user role is permitted to do.\n';
          manual += '• `/claim-admin` — Register as an administrator (if eligible).\n';
          
          if (isAdmin) {
            manual += '• `/clear` — Wipe my short-term memory for this chat.\n';
            manual += '• `/halt` — Emergency stop (prevents processing for 1 hour).\n';
            manual += '• `/resume` — Restore processing after a halt.\n';
          }
          
          if (isSuper) {
            manual += '• `/morning on/off` — Toggle my daily motivation broadcast.\n';
          }
 
          if (isDm) {
            manual += '\n🔐 *Secret Management (DM Only)*\n';
            manual += '• `/secret LABEL VALUE` — Securely encrypt and store a secret.\n';
            manual += '• `/secrets` — List your stored secret labels.\n';
            manual += '• `/delete-secret LABEL` — Permanently remove a secret.\n';
          } else {
            manual += '\n💡 *Tip:* Message me in DM to manage your `/secrets` privately.';
          }
 
          await this.replySender.sendReply(
            String(update.message?.chat.id),
            manual,
            undefined,
            'MarkdownV2',
          );
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
          
          this.logger.log(`[CLEAR] Memory cleared for chat ${chatId} by admin ${senderId}`);
          await this.auditLogger.log({
            actionType: 'memory_clear',
            telegramId: senderId,
            sanitizedSummary: `Memory cleared for chat ${chatId}`,
          });

          await this.replySender.sendReply(
            chatId,
            "🗑️ Elena's hot memory cleared. Context reset to Day 1.",
            undefined,
            null,
          );
          return { ok: true };
        }

        if (lower === '/morning on' || lower === '/morning off') {
          const senderId = String(update.message?.from?.id);
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { role: true },
          });

          // Phase 6: Superadmin only
          if (!sender || sender.role !== 'superadmin') {
            return { ok: true }; // Silent drop for non-superadmin
          }

          if (lower === '/morning on') {
            await this.redisService.client.set('elena:morning:enabled', '1');
            this.logger.log(`[CONFIG] Morning messages enabled by superadmin ${senderId}`);
            await this.auditLogger.log({
              actionType: 'config_change',
              telegramId: senderId,
              sanitizedSummary: 'Morning messages enabled',
            });
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '✅ Morning messages enabled. Will fire daily at 8am.',
              undefined,
              null,
            );
          } else {
            await this.redisService.client.del('elena:morning:enabled');
            this.logger.log(`[CONFIG] Morning messages disabled by superadmin ${senderId}`);
            await this.auditLogger.log({
              actionType: 'config_change',
              telegramId: senderId,
              sanitizedSummary: 'Morning messages disabled',
            });
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '🛑 Morning messages disabled.',
              undefined,
              null,
            );
          }
          return { ok: true };
        }

        if (lower === '/halt') {
          const senderId = String(update.message?.from?.id);
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { role: true },
          });

          if (!sender || !['admin', 'superadmin'].includes(sender.role)) {
            return { ok: true }; // Silent drop
          }

          // Check current state for idempotency
          const currentHalt = await this.redisService.client.get('elena:halt');
          if (currentHalt) {
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '⚠️ Elena is already halted.',
              undefined,
              null,
            );
            return { ok: true };
          }

          // Set halt flag in Redis — MessageProcessor checks this flag
          await this.redisService.client.set('elena:halt', '1', { ex: 3600 });
          
          this.logger.warn(`[HALT] System EMERGENCY STOP triggered by admin ${senderId}`);
          await this.auditLogger.log({
            actionType: 'system_halt',
            telegramId: senderId,
            sanitizedSummary: 'System halted via /halt command',
          });

          await this.replySender.sendReply(
            String(update.message?.chat.id),
            '🛑 Elena halted. No new messages will be processed for 1 hour. Use /resume to restore.',
            undefined,
            null,
          );
          return { ok: true };
        }

        if (lower === '/resume') {
          const senderId = String(update.message?.from?.id);
          const sender = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { role: true },
          });

          if (!sender || !['admin', 'superadmin'].includes(sender.role)) {
            return { ok: true };
          }

          // Check current state for idempotency
          const currentHalt = await this.redisService.client.get('elena:halt');
          if (!currentHalt) {
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '⚠️ Elena is already online and active.',
              undefined,
              null,
            );
            return { ok: true };
          }

          await this.redisService.client.del('elena:halt');
          
          this.logger.log(`[HALT] System RESUMED by admin ${senderId}`);
          await this.auditLogger.log({
            actionType: 'system_resume',
            telegramId: senderId,
            sanitizedSummary: 'System resumed via /resume command',
          });

          await this.replySender.sendReply(
            String(update.message?.chat.id),
            '✅ Elena resumed. Back online.',
            undefined,
            null,
          );
          return { ok: true };
        }

        if (lower.startsWith('/secret ')) {
          const senderId = String(update.message?.from?.id);

          // Phase 5.1 Refinement: Enforce DM-only for security
          // Use parsed.isDm if available, but here we are in the messageText block before parsed is created.
          // We can check update.message.chat.type
          const isDm = update.message?.chat.type === 'private';
          if (!isDm) {
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '⚠️ For security, you can only store secrets via DM with Elena.',
              undefined,
              null,
            );
            return { ok: true };
          }

          const senderUser = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { id: true, role: true },
          });

          if (!senderUser || senderUser.role === 'guest') {
            return { ok: true }; // Guests cannot store secrets
          }

          // Parse: /secret LABEL VALUE [expires:DAYS]
          const parts = messageText.trim().split(/\s+/);
          if (parts.length < 3) {
            await this.replySender.sendReply(
              String(update.message?.chat.id),
              '⚠️ Usage: `/secret LABEL VALUE` or `/secret LABEL VALUE expires:30`',
              undefined,
              null,
            );
            return { ok: true };
          }

          const label = parts[1];
          const expiresMatch = parts[parts.length - 1].match(/^expires:(\d+)$/i);
          const hasExpires = !!expiresMatch;
          const value = hasExpires 
            ? parts.slice(2, -1).join(' ')
            : parts.slice(2).join(' ');
          
          const expiresAt = hasExpires 
            ? new Date(Date.now() + parseInt(expiresMatch![1]) * 24 * 60 * 60 * 1000)
            : undefined;

          // derivationId = senderId (Telegram ID)
          await this.vaultService.storeSecret(senderUser.id, senderId, label, value, expiresAt);

          // Delete the message immediately for security (prevent secret appearing in chat)
          if (update.message?.message_id) {
            await this.replySender.deleteMessage(
              String(update.message.chat.id),
              update.message.message_id,
            );
          }

          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          const expiryText = expiresAt 
            ? ` \\(expires ${expiresAt.toLocaleDateString()}\\)` 
            : '';
          
          // DM the confirmation — never reply in group with secret confirmation
          await this.replySender.sendReply(
            senderId,
            `🔐 Secret *${label}* stored securely at ${timeStr}${expiryText}. The message has been deleted from the chat.`,
            undefined,
            'MarkdownV2',
          );

          return { ok: true };
        }

        if (lower === '/secrets') {
          const senderId = String(update.message?.from?.id);
          const senderUser = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { id: true, role: true },
          });

          if (!senderUser || senderUser.role === 'guest') {
            return { ok: true };
          }

          const secrets = await this.vaultService.listSecrets(senderUser.id);
          
          if (secrets.length === 0) {
            await this.replySender.sendReply(
              senderId,
              '🔐 You have no stored secrets.',
              undefined,
              null,
            );
            return { ok: true };
          }

          const list = secrets.map(s => 
            `• *${s.label}*${s.expiresAt ? ` (expires ${s.expiresAt.toLocaleDateString()})` : ''}`
          ).join('\n');

          await this.replySender.sendReply(
            senderId,
            `🔐 *Your Secrets* (labels only — values never shown):\n\n${list}`,
            undefined,
            'MarkdownV2',
          );
          return { ok: true };
        }

        if (lower.startsWith('/delete-secret ')) {
          const senderId = String(update.message?.from?.id);
          const isDm = update.message?.chat.type === 'private';
          
          if (!isDm) return { ok: true };
          
          const senderUser = await this.prisma.user.findUnique({
            where: { telegramId: senderId },
            select: { id: true, role: true },
          });

          if (!senderUser || senderUser.role === 'guest') {
            return { ok: true };
          }

          const parts = messageText.trim().split(/\s+/);
          if (parts.length < 2) {
            await this.replySender.sendReply(
              senderId,
              '⚠️ Usage: `/delete-secret LABEL`',
              undefined,
              null,
            );
            return { ok: true };
          }

          const label = parts[1];
          await this.vaultService.deleteSecret(senderUser.id, label);
          
          await this.replySender.sendReply(
            senderId,
            `🗑️ Secret *${label}* deleted.`,
            undefined,
            'MarkdownV2',
          );
          return { ok: true };
        }

        // Catch-all for unknown slash commands
        if (lower.startsWith('/')) {
          await this.replySender.sendReply(
            String(update.message?.chat.id),
            `Elena doesn't recognize that command. Type \`/manual\` to see what I can do\\.`,
            update.message?.message_id,
            'MarkdownV2',
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

        // Auto-register user-group relationship for cross-chat reminders
        // Only register for known/approved users — not guests being created now
        const registeredUser = await this.prisma.user.findUnique({
          where: { telegramId: parsed.userId },
          select: { id: true, onboardingStatus: true },
        });

        if (registeredUser && registeredUser.onboardingStatus === 'approved') {
          await this.prisma.userGroup.upsert({
            where: {
              userId_chatId: {
                userId: registeredUser.id,
                chatId: parsed.chatId,
              },
            },
            update: { lastSeenAt: new Date() },
            create: {
              userId: registeredUser.id,
              chatId: parsed.chatId,
            },
          });
        }
      } else {
        // In DMs: If user is unknown (not in DB), ignore them completely but alert admins
        if (!sender) {
          this.logger.warn(
            `[SECURITY_TRACE] Ignoring DM from unknown user ${parsed.userId}. (Group-First Guard ACTIVE)`,
          );

          // Phase 5.1 Fix: Send Stranger Activity Alert
          const from = update.message?.from || update.callback_query?.from;
          await this.securityAlert.sendStrangerAlert(
            parsed.userId,
            from?.first_name || 'Anonymous',
            from?.username || null,
            parsed.text || null,
          );

          return { ok: true };
        }
      }

      // Step 3: Stage 1 heuristic gate (zero cost)
      if (!shouldProcess(parsed)) {
        return { ok: true };
      }

      // Jailbreak detection — runs alongside pipeline, logs & alerts but does not block AI reply
      if (parsed.text) {
        const isInjection = await this.jailbreakDetector.detect(
          parsed.text,
          parsed.userId,
          parsed.chatId,
        );
        if (isInjection) {
          // Still queue the job — let Filter Agent handle the user-facing reply in Elena's voice
          // But the detection + admin alert already fired
          await this.auditLogger.log({
            actionType: 'jailbreak_detected',
            telegramId: parsed.userId,
            jobId: String(update.update_id),
            sanitizedSummary: parsed.text.slice(0, 200),
          });
        }
      }

      // Step 4: Rate limiting (Phase 6)
      const rateLimit = await this.rateLimiter.check(parsed.userId);
      if (!rateLimit.allowed) {
        this.logger.warn(`[RATE_LIMIT] Blocking request from ${parsed.userId}. Too many requests.`);
        await this.replySender.sendReply(
          parsed.chatId,
          `Whoa! Slow down 😅 — give me a moment to breathe. Try again in about ${rateLimit.remaining > 0 ? rateLimit.remaining : 60} seconds.`,
          undefined,
          null,
        );
        return { ok: true };
      }

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
