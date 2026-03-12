/**
 * Splits text into chunks by word count for embedding token limit safety.
 * gemini-embedding-001 hard limit = 2048 tokens ≈ 1500 words.
 * Used by summarize.handler.ts before embedding calls.
 */
export function semanticChunk(text: string, maxWords: number): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    if (words.length === 0) {
        return [];
    }

    if (words.length <= maxWords) {
        return [text.trim()];
    }

    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
        chunks.push(words.slice(i, i + maxWords).join(' '));
    }
    return chunks;
}
