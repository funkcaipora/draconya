import { describe, expect, it } from 'vitest';
import { chatBadgeTier } from './chat-badge.js';
import type { SystemLine } from '../state/hud.js';

function systemLine(level: SystemLine['level'], atMs: number): SystemLine {
  return { level, atMs, text: 'message' };
}

describe('chatBadgeTier', () => {
  it('never shows a badge while the chat is open', () => {
    expect(chatBadgeTier([], true, 0)).toBeNull();
    expect(chatBadgeTier([systemLine('error', 10)], true, 0)).toBeNull();
  });

  it('does not repeat a message that was already seen', () => {
    const messages = [systemLine('warning', 10)];

    expect(chatBadgeTier([], false, 0)).toBeNull();
    expect(chatBadgeTier(messages, false, 10)).toBeNull();
    expect(chatBadgeTier(messages, false, 11)).toBeNull();
  });

  it('maps error to danger and informational severities to gold', () => {
    expect(chatBadgeTier([systemLine('error', 10)], false, 0)).toBe('danger');
    expect(chatBadgeTier([systemLine('info', 10)], false, 0)).toBe('gold');
    expect(chatBadgeTier([systemLine('warning', 10)], false, 0)).toBe('gold');
  });

  it('uses the most recent unseen system message', () => {
    expect(chatBadgeTier([
      systemLine('error', 10),
      systemLine('info', 11),
    ], false, 0)).toBe('gold');
    expect(chatBadgeTier([
      systemLine('info', 10),
      systemLine('error', 11),
    ], false, 0)).toBe('danger');
  });
});
