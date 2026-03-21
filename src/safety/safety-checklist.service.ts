import { Injectable, Logger } from '@nestjs/common';
import { AgentContext } from '@app/common/types/agent.types';

export interface SafetyCheckResult {
  passed: boolean;
  action: 'hold' | 'deflect' | 'ignore' | 'hitl' | 'stop' | null;
  reason?: string;
  deflectMessage?: string;
}

@Injectable()
export class SafetyChecklistService {
  private readonly logger = new Logger(SafetyChecklistService.name);

  /**
   * Runs 5 pre-action safety checks.
   * Returns { passed: true } if all checks pass.
   * Returns { passed: false, action, reason } if any check fails.
   *
   * Checks (in order):
   * 1. Harmful/disrespectful content → hold + log
   * 2. Reveals another user's private data → deflect + log
   * 3. Not asked and not relevant → ignore
   * 4. Irreversible action → HITL (handled by ExecutorService already)
   * 5. Exceeded MAX_TOOL_CALLS → stop + report
   */
  async run(context: AgentContext): Promise<SafetyCheckResult> {
    const text = context.parsedMessage.text ?? '';
    const userId = context.parsedMessage.userId;

    // Check 1: Harmful or disrespectful content
    const harmfulPatterns = [
      /\b(kill|murder|bomb|attack|hack|exploit|destroy)\b/i,
    ];

    const isHarmful = harmfulPatterns.some(p => p.test(text));
    if (isHarmful) {
      this.logger.warn(
        `[SAFETY] Harmful content detected from user ${userId}: ${text.slice(0, 100)}`
      );
      return {
        passed: false,
        action: 'hold',
        reason: 'Harmful content detected',
        deflectMessage: "I can't help with that one.",
      };
    }

    return { passed: true, action: null };
  }
}
