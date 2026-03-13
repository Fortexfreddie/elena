import type { ParsedMessage } from '@app/common/types/telegram.types';

/**
 * Stage 1 heuristic pre-filter — zero cost, no AI.
 *
 * Returns true if the message should be processed further.
 * Returns false if it should be silently discarded (no response, no reaction).
 *
 * Pass conditions:
 * 1. DM (private chat) → always process
 * 2. Reply to bot's message → always process
 * 3. Mentions Elena by name (case-insensitive) → process
 * 4. Starts with a command directed at Elena → process
 *
 * Everything else → discard.
 */
export function shouldProcess(parsed: ParsedMessage): boolean {
    // DMs always pass — user messaged Elena directly
    if (parsed.isDm) {
        return true;
    }

    // Reply to bot's message always passes
    if (parsed.replyToBot) {
        return true;
    }

    // No text means media-only message in group with no mention — skip
    const text = parsed.text;
    if (!text) {
        return false;
    }

    const lower = text.toLowerCase();

    // Name mention check
    if (containsElenaMention(lower)) {
        return true;
    }

    // Technical Keyword Check (Active Listening)
    // Allows technical developer discussions to reach the FilterAgent even without a tag
    if (containsTechnicalKeywords(lower)) {
        return true;
    }

    // Everything else in a group chat → discard
    // Note: /confirm_ and /cancel_ are handled by the controller BEFORE
    // the gate runs, so they never reach this point.
    return false;
}

import { TECHNICAL_KEYWORDS } from '@app/common/gemini/gemini.constants';

/**
 * Stage 1.5 Keyword Heuristic for developer group chats.
 */
function containsTechnicalKeywords(lowerText: string): boolean {
    return TECHNICAL_KEYWORDS.some((keyword) => lowerText.includes(keyword));
}

/**
 * Check if the text mentions Elena by name or common variations.
 */
function containsElenaMention(lowerText: string): boolean {
    const triggers = [
        'elena',
        '@elena',
        'hey elena',
        'yo elena',
    ];

    return triggers.some((trigger) => lowerText.includes(trigger));
}
