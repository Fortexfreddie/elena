/**
 * Escapes characters for Telegram HTML parse_mode.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Intelligently escapes characters for Telegram MarkdownV2 parse_mode.
 * 
 * Strategy:
 * 1. Protect code blocks and links (no escaping inside).
 * 2. Identify bold/italic blocks and escape their internal content.
 * 3. Escape all reserved characters in other text.
 */
export function escapeMarkdownV2(text: string): string {
    // 1. Pre-process headers and Gemini's double-star bold
    let processed = text.split('\n').map(line => {
        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
        return headerMatch ? `*${headerMatch[2]}*` : line;
    }).join('\n');

    // Convert **bold** to *bold* (Telegram MarkdownV2 style)
    processed = processed.replace(/\*\*(.*?)\*\*/g, '*$1*');

    // Helper to escape the literal set of reserved characters
    const escapeReserved = (s: string) => s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

    // 2. Identify blocks to protect (Code blocks and Links)
    const protectedBlocks: string[] = [];
    const placeholder = (i: number) => `\x00ELENA_BLOCK_${i}\x00`;
    
    // Pattern matches triple backticks, single backticks, Links [text](url), or plain URLs
    processed = processed.replace(/(```[\s\S]*?```)|(`[^`\r\n]*`)|(\[.*?\]\(.*?\))|(https?:\/\/\S+)/g, (match) => {
        let protectedBlock = match;
        // Case: Plain URL (not inside a link) — encode parens to avoid reserved char issues
        if (match.startsWith('http')) {
            protectedBlock = match.replace(/\(/g, '%28').replace(/\)/g, '%29');
        }
        protectedBlocks.push(protectedBlock);
        return placeholder(protectedBlocks.length - 1);
    });

    // 3. Use regex to find bold/italic blocks and escape content inside them
    // Note: We only match "single-line" or contiguous bold/italic to keep it safe.
    // Group 1: Bold (*...*)
    // Group 2: Italic (_..._)
    // Group 3: Single reserved char (not part of a block)
    const blockRegex = /(\*[\s\S]*?\*)|(_[\s\S]*?_)|([_*\[\]()~`>#+\-=|{}.!\\])/g;

    processed = processed.replace(blockRegex, (match, bold, italic, char) => {
        if (bold) {
            // Escape content inside *bold text* but keep the stars
            return '*' + escapeReserved(bold.slice(1, -1)) + '*';
        }
        if (italic) {
            // Escape content inside _italic text_ but keep the underscores
            return '_' + escapeReserved(italic.slice(1, -1)) + '_';
        }
        // It's a reserved char outside any block, escape it
        return '\\' + char;
    });

    // 4. Restore protected blocks (Unescaped)
    protectedBlocks.forEach((block, i) => {
        processed = processed.replace(placeholder(i), block);
    });

    return processed;
}
