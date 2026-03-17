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
  let processed = text
    .split('\n')
    .map((line) => {
      const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      return headerMatch ? `*${headerMatch[2]}*` : line;
    })
    .join('\n');

  // Convert **bold** to *bold* (Telegram MarkdownV2 style)
  processed = processed.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // Helper to escape characters for MarkdownV2
  // Telegram requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Characters MUST be escaped if not part of a formatting block.
  const escapeReserved = (s: string) =>
    s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

  // 1. Protect code blocks and links FIRST
  const protectedBlocks: string[] = [];
  const placeholder = (i: number) => `\x00ELENA_BLOCK_${i}\x00`;

  processed = processed.replace(
    /(```[\s\S]*?```)|(`[^`\r\n]*`)|(\[.*?\]\(.*?\))|(https?:\/\/\S+)/g,
    (match) => {
      let protectedBlock = match;
      if (match.startsWith('http')) {
        protectedBlock = match.replace(/\(/g, '%28').replace(/\)/g, '%29');
      }
      protectedBlocks.push(protectedBlock);
      return placeholder(protectedBlocks.length - 1);
    },
  );

  // 2. Escape everything else string-wide EXCEPT for our bold/italic markers
  // We'll temporarily hide our markers too
  processed = processed
    .replace(/\*([\s\S]*?)\*/g, '\x01$1\x01')
    .replace(/_([\s\S]*?)_/g, '\x02$1\x02');

  // 3. Escape everything that isn't a block or marker
  processed = escapeReserved(processed);

  // 4. Restore markers and finish escaping their internals
  processed = processed.replace(/\x01(.*?)\x01/g, (_, content) => {
    return '*' + content + '*';
  });
  processed = processed.replace(/\x02(.*?)\x02/g, (_, content) => {
    return '_' + content + '_';
  });

  // 5. Restore protected blocks
  protectedBlocks.forEach((block, i) => {
    processed = processed.replace(placeholder(i), block);
  });

  return processed;
}
