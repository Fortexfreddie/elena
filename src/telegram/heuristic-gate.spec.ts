import { shouldProcess } from './heuristic-gate';
import type { ParsedMessage } from '@app/common/types/telegram.types';

describe('HeuristicGate', () => {
  const baseMessage: ParsedMessage = {
    userId: '1',
    chatId: '111',
    text: 'hello',
    telegramDate: 1234567,
    updateId: 100,
    replyToBot: false,
    isDm: false,
    hasMedia: false,
    mediaFileId: null,
    mediaFileSize: null,
    mediaType: null,
    rawUpdate: {} as any,
    replyToContext: null,
    isSticker: false,
  };

  it('should pass if it is a DM', () => {
    const msg = { ...baseMessage, isDm: true };
    expect(shouldProcess(msg)).toBe(true);
  });

  it('should pass if it is a reply to the bot', () => {
    const msg = { ...baseMessage, replyToBot: true };
    expect(shouldProcess(msg)).toBe(true);
  });

  it('should pass if it mentions "elena"', () => {
    const msg = { ...baseMessage, text: 'Hey elena how are you' };
    expect(shouldProcess(msg)).toBe(true);
  });

  it('should pass if it mentions "@elena"', () => {
    const msg = { ...baseMessage, text: 'tell @elena to help' };
    expect(shouldProcess(msg)).toBe(true);
  });

  it('should pass if it is a confirm command', () => {
    const msg = { ...baseMessage, text: '/confirm_123' };
    expect(shouldProcess(msg)).toBe(true);
  });

  it('should discard if no mention in a group', () => {
    const msg = { ...baseMessage, text: 'random chat message' };
    expect(shouldProcess(msg)).toBe(false);
  });

  it('should discard if it is media-only in a group with no caption', () => {
    const msg = {
      ...baseMessage,
      text: null,
      hasMedia: true,
      mediaType: 'image/jpeg',
    };
    expect(shouldProcess(msg)).toBe(false);
  });

  it('should pass if it is media with a caption mentioning elena', () => {
    const msg = {
      ...baseMessage,
      text: 'look at this elena',
      hasMedia: true,
      mediaType: 'image/jpeg',
    };
    expect(shouldProcess(msg)).toBe(true);
  });
});
