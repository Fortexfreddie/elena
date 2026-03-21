import { Injectable, Logger } from '@nestjs/common';
import { DmDispatcherService } from '../telegram/dm.dispatcher';
import { PrismaService } from '@app/database';

@Injectable()
export class JailbreakDetectorService {
  private readonly logger = new Logger(JailbreakDetectorService.name);

  // Known prompt injection patterns
  private readonly INJECTION_PATTERNS = [
    /ignore.*instructions/i,
    /disregard.*instructions/i,
    /forget.*instructions/i,
    /you are now (a|an|the)?\s*(different|new|unrestricted|free)/i,
    /act as (a|an)?\s*(different|new|unrestricted|free|jailbreak)/i,
    /pretend (you are|to be|you're)\s*(a|an)?\s*(different|unrestricted)/i,
    /you have no (rules|restrictions|limits|guidelines)/i,
    /bypass (your|the|all)?\s*(safety|filter|restriction|rule|guideline)/i,
    /override (your|the|all)?\s*(safety|filter|restriction|rule|guideline)/i,
    /DAN (mode|prompt)/i,
    /jailbreak/i,
    /prompt injection/i,
    /\[SYSTEM\]/i,
    /\[INST\]/i,
    /###\s*(system|instruction|prompt)/i,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly dmDispatcher: DmDispatcherService,
  ) { }

  /**
   * Checks text for known jailbreak/injection patterns.
   * Returns true if injection detected.
   * Logs the attempt and DMs all admins/superadmins.
   */
  async detect(
    text: string,
    userId: string,
    chatId: string,
  ): Promise<boolean> {
    this.logger.warn(`[SAFETY_EVAL] Detector evaluating text: "${text}"`);

    const detected = this.INJECTION_PATTERNS.some((pattern) =>
      pattern.test(text),
    );

    if (!detected) {
      this.logger.warn(`[SAFETY_EVAL] Detection returned false.`);
      return false;
    }

    this.logger.warn(
      `[JAILBREAK] Prompt injection detected from user ${userId} in chat ${chatId}: ${text.slice(0, 100)}`,
    );

    // Alert all admins and superadmins
    try {
      const sender = await this.prisma.user.findUnique({
        where: { telegramId: userId },
        select: { displayName: true, username: true },
      });
      const usernameText = sender?.username ? `@${sender.username}` : sender?.displayName ?? 'Unknown';

      const admins = await this.prisma.user.findMany({
        where: {
          role: { in: ['admin', 'superadmin'] },
          isActive: true,
        },
        select: { telegramId: true },
      });

      const alertText = `🚨 *Prompt Injection Detected*\n\nUser: ${usernameText} (\`${userId}\`)\nChat: \`${chatId}\`\nAttempt: \`${text.slice(0, 200)}\``;

      for (const admin of admins) {
        await this.dmDispatcher
          .sendDm(admin.telegramId, alertText)
          .catch(() => { });
      }
    } catch (err) {
      this.logger.error('Failed to alert admins of jailbreak attempt', err);
    }

    return true;
  }
}
