import { semanticChunk } from './semantic-chunk';

describe('SemanticChunkUtils', () => {
  it('should return empty array for empty string', () => {
    expect(semanticChunk('', 10)).toEqual([]);
  });

  it('should not chunk if word count is less than maxWords', () => {
    const text = 'one two three';
    expect(semanticChunk(text, 5)).toEqual(['one two three']);
  });

  it('should split into chunks by word count', () => {
    const text = 'one two three four five';
    expect(semanticChunk(text, 2)).toEqual(['one two', 'three four', 'five']);
  });

  it('should ignore multiple spaces', () => {
    const text = 'one    two   three';
    expect(semanticChunk(text, 2)).toEqual(['one two', 'three']);
  });
});
