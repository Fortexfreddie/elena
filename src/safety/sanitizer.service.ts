import { Injectable } from '@nestjs/common';

@Injectable()
export class SanitizerService {
  /**
   * Two-layer sanitization before anything leaves to Langfuse or audit logs.
   *
   * LAYER 1 — Dynamic exact-match (catches custom secrets):
   *   Receives decryptedSecretsSet: Set<string>
   *   LENGTH GUARD: if secret.length < 6 → skip (prevents output mangling)
   *   Replaces each secret value with [REDACTED_SECRET]
   *
   * LAYER 2 — Regex patterns (catches common key formats):
   *   Runs after Layer 1
   */
  sanitize(text: string, decryptedSecretsSet: Set<string> = new Set()): string {
    let result = text;

    // LAYER 1: Dynamic exact-match on decrypted secrets
    for (const secret of decryptedSecretsSet) {
      // LENGTH GUARD: skip very short secrets to prevent mangling normal words
      if (secret.length < 6) continue;
      // Use split/join for global replace without regex special char issues
      result = result.split(secret).join('[REDACTED_SECRET]');
    }

    // LAYER 2: Regex patterns for common key formats
    result = result
      .replace(/x-telegram-bot-api-secret-token["\s:]+[a-fA-F0-9]{20,}/gi, 'x-telegram-bot-api-secret-token: [REDACTED]')
      .replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED_API_KEY]')
      .replace(/Bearer [a-zA-Z0-9\-._~+\/]+=*/g, '[REDACTED_BEARER]')
      .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_PRIVATE_KEY]')
      .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED_GOOGLE_KEY]')
      .replace(/xai-[a-zA-Z0-9]{32,}/g, '[REDACTED_XAI_KEY]')
      .replace(/bot[A-Za-z0-9_:]{20,}/g, 'bot[REDACTED]')
      // 12-word seed phrase
      .replace(/^([a-z]+\s){11}[a-z]+$/gm, '[REDACTED_SEED_PHRASE]')
      // 24-word seed phrase
      .replace(/^([a-z]+\s){23}[a-z]+$/gm, '[REDACTED_SEED_PHRASE]')
      // JWT (3 base64url segments separated by dots)
      .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');

    return result;
  }
}
