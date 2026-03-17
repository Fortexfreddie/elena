import { chunkMessage } from './chunk';

describe('ChunkUtils', () => {
  it('should not chunk if text is shorter than maxLen', () => {
    const text = 'hello world';
    const chunks = chunkMessage(text, 20);
    expect(chunks).toEqual(['hello world']);
  });

  it('should split on double newline if possible', () => {
    const text = 'Line 1\n\nLine 2';
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['Line 1\n\n', 'Line 2']);
  });

  it('should split on single newline if no double newline', () => {
    const text = 'Line 1\nLine 2';
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['Line 1\n', 'Line 2']);
  });

  it('should split on space if no newline', () => {
    const text = 'Hello world how';
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['Hello ', 'world how']);
  });

  it('should maintain bold state across chunks', () => {
    const text = 'This is **very bold text** here';
    const chunks = chunkMessage(text, 15);
    // Chunk 1: "This is **very **"
    // Chunk 2: "**bold text** here"
    expect(chunks[0]).toContain('**');
    expect(chunks[0]).toMatch(/\*\*$/); // closed at end
    expect(chunks[1]).toMatch(/^\*\*/); // reopened at start
  });

  it('should maintain code block state across chunks', () => {
    const text = 'Code:\n```ts\nconst x = 1;\nconst y = 2;\n```';
    const chunks = chunkMessage(text, 25);
    expect(chunks[0]).toContain('```ts');
    expect(chunks[0]).toMatch(/```$/); // closed
    expect(chunks[1]).toMatch(/^```ts/); // reopened with language
  });

  it('should maintain italic state across chunks', () => {
    const text = 'Some _italic text_ example';
    const chunks = chunkMessage(text, 15);
    expect(chunks[0]).toMatch(/_$/);
    expect(chunks[1]).toMatch(/^_/);
  });
});
