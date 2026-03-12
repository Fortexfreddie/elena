import { TELEGRAM_MAX_CHARS } from '../gemini/gemini.constants.js';

interface MarkdownState {
    isBold: boolean;
    isItalic: boolean;
    isInlineCode: boolean;
    isCodeBlock: boolean;
    codeBlockLang: string;
}

/**
 * Splits a long message into Telegram-safe chunks (≤4096 chars).
 * Markdown-aware: tracks bold, italic, inline code, and code block state.
 * Closes open tags at chunk end, reopens them at chunk start.
 *
 * Split priority: \n\n → \n → last space → hard cut
 */
export function chunkMessage(
    text: string,
    maxLen: number = TELEGRAM_MAX_CHARS,
): string[] {
    if (text.length <= maxLen) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;
    let state: MarkdownState = {
        isBold: false,
        isItalic: false,
        isInlineCode: false,
        isCodeBlock: false,
        codeBlockLang: '',
    };

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(applyPrefix(remaining, state));
            break;
        }

        const slice = remaining.slice(0, maxLen);
        const splitIdx = findSplitPoint(slice, maxLen);
        let chunk = remaining.slice(0, splitIdx);
        remaining = remaining.slice(splitIdx);

        // Track markdown state through this chunk
        const newState = trackMarkdownState(chunk, state);

        // Close any open tags at the end of the chunk
        const suffix = buildClosingSuffix(newState);
        chunk = applyPrefix(chunk, state) + suffix;

        chunks.push(chunk);

        // The next chunk needs to reopen the tags
        state = newState;
    }

    return chunks;
}

function findSplitPoint(text: string, maxLen: number): number {
    // Priority: \n\n → \n → last space → hard cut
    const doubleNewline = text.lastIndexOf('\n\n');
    if (doubleNewline > maxLen * 0.5) {
        return doubleNewline + 2;
    }

    const singleNewline = text.lastIndexOf('\n');
    if (singleNewline > maxLen * 0.5) {
        return singleNewline + 1;
    }

    const lastSpace = text.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.5) {
        return lastSpace + 1;
    }

    return maxLen;
}

function trackMarkdownState(
    text: string,
    initial: MarkdownState,
): MarkdownState {
    const state = { ...initial };

    for (let i = 0; i < text.length; i++) {
        // Code block detection: ```
        if (text.slice(i, i + 3) === '```') {
            if (state.isCodeBlock) {
                state.isCodeBlock = false;
                state.codeBlockLang = '';
            } else {
                state.isCodeBlock = true;
                // Capture language hint after ```
                const rest = text.slice(i + 3);
                const langMatch = /^([a-zA-Z0-9]+)/.exec(rest);
                state.codeBlockLang = langMatch ? langMatch[1] : '';
            }
            i += 2; // skip past ```
            continue;
        }

        // Inside code block, don't track inline formatting
        if (state.isCodeBlock) continue;

        // Inline code: `
        if (text[i] === '`') {
            state.isInlineCode = !state.isInlineCode;
            continue;
        }

        // Inside inline code, don't track formatting
        if (state.isInlineCode) continue;

        // Bold: **
        if (text.slice(i, i + 2) === '**') {
            state.isBold = !state.isBold;
            i += 1;
            continue;
        }

        // Italic: _ (single underscore, not inside a word)
        if (text[i] === '_' && text[i + 1] !== '_') {
            state.isItalic = !state.isItalic;
            continue;
        }
    }

    return state;
}

function buildClosingSuffix(state: MarkdownState): string {
    let suffix = '';
    if (state.isInlineCode) suffix += '`';
    if (state.isBold) suffix += '**';
    if (state.isItalic) suffix += '_';
    if (state.isCodeBlock) suffix += '\n```';
    return suffix;
}

function applyPrefix(text: string, state: MarkdownState): string {
    let prefix = '';
    if (state.isCodeBlock) {
        prefix += '```' + state.codeBlockLang + '\n';
    }
    if (state.isItalic) prefix += '_';
    if (state.isBold) prefix += '**';
    if (state.isInlineCode) prefix += '`';
    return prefix + text;
}
