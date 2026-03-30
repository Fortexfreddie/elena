import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@app/database';
import { UpstashRedisService } from '@app/common';
import { ReplySenderService } from '../telegram/reply.sender';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';

interface BibleApiResponse {
  random_verse: {
    book: string;
    chapter: number;
    verse: number;
    text: string;
  };
}

@Injectable()
export class MorningMessageHandler {
  private readonly logger = new Logger(MorningMessageHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: UpstashRedisService,
    private readonly replySender: ReplySenderService,
    private readonly geminiService: GeminiService,
  ) {}

  async handle(job: Job): Promise<void> {
    this.logger.log('[MORNING] Morning message job triggered');

    // Check kill-switch first
    const isEnabled = await this.redisService.client.get('elena:morning:enabled');
    if (!isEnabled) {
      this.logger.log('[MORNING] Morning messages are disabled (elena:morning:enabled not set). Skipping.');
      return;
    }

    // Get all distinct approved group chat IDs from UserGroup
    const groupChats = await this.prisma.userGroup.findMany({
      distinct: ['chatId'],
      select: { chatId: true },
    });

    if (groupChats.length === 0) {
      this.logger.warn('[MORNING] No group chats found. Skipping morning message.');
      return;
    }

    // Fetch 3 random Bible verses in parallel to pick the most motivational one
    const verses: { text: string; reference: string }[] = [];
    const fetchVerse = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch('https://bible-api.com/data/web/random', {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) return null;
        const data = (await response.json()) as BibleApiResponse;
        if (!data?.random_verse?.text) return null;
        return {
          text: data.random_verse.text.trim().replace(/\n+/g, ' '),
          reference: `${data.random_verse.book} ${data.random_verse.chapter}:${data.random_verse.verse}`,
        };
      } catch {
        return null;
      }
    };

    try {
      const results = await Promise.all([fetchVerse(), fetchVerse(), fetchVerse()]);
      for (const r of results) {
        if (r) verses.push(r);
      }
    } catch (err: unknown) {
      this.logger.error(`[MORNING] Parallel fetch fail: ${String(err)}`);
    }

    if (verses.length === 0) {
      this.logger.warn('[MORNING] Could not fetch any verses. Skipping.');
      return;
    }

    const versesList = verses
      .map((v, i) => `Option ${i + 1}: "${v.text}" — ${v.reference}`)
      .join('\n\n');

    // Wrap the verse with Elena's personality using Gemini
    let morningMessage: string;
    try {
      const result = await this.geminiService.generateContent(
        GEMINI_MODELS.FLASH,
        [
          {
            role: 'user',
            parts: [
              {
                text: `You are Elena — a sharp, warm, no-nonsense AI squad assistant for a web3 dev team. 
Write a short morning message (3–5 sentences max) for the squad group chat.

I have fetched 3 random Bible verses. Pick the ONE that is most motivational or relevant to engineers, builders, and problem solvers, then wrap it into your message.

Candidates:
${versesList}

Rules:
- Sound like a squad teammate, not a pastor or a bot
- Be warm, motivational, grounded — not preachy
- Start with a simple morning greeting
- End with something encouraging for the day ahead
- Use plain text only (no markdown, no asterisks)`,
              },
            ],
          },
        ],
      );
      morningMessage = result.text?.trim() ?? `Good morning squad ☀️\n\n"${verses[0].text}" — ${verses[0].reference}\n\nLet's make today count.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[MORNING] Gemini wrap failed: ${msg} — using first verse`);
      morningMessage = `Good morning squad ☀️\n\n"${verses[0].text}"\n— ${verses[0].reference}\n\nLet's make today count.`;
    }

    // Send to all group chats
    let sent = 0;
    for (const { chatId } of groupChats) {
      try {
        await this.replySender.sendReply(chatId, morningMessage, undefined, null);
        this.logger.log(`[MORNING] Sent to chat ${chatId}`);
        sent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[MORNING] Failed to send to chat ${chatId}: ${msg}`);
      }
    }

    this.logger.log(`[MORNING] Done — sent to ${sent}/${groupChats.length} group chats`);
  }
}
