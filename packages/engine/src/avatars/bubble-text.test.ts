import { describe, expect, it } from 'vitest';
import { wrapBubbleText } from './bubble-text.ts';

// One unit per character, so widths are easy to reason about.
const measure = (s: string) => Array.from(s).length;

describe('wrapBubbleText', () => {
  it('keeps short text on one line', () => {
    expect(wrapBubbleText('hi there', 10, 3, measure)).toEqual(['hi there']);
  });

  it('wraps at word boundaries', () => {
    expect(wrapBubbleText('the quick brown fox jumps', 10, 3, measure)).toEqual([
      'the quick',
      'brown fox',
      'jumps',
    ]);
  });

  it('breaks a word longer than a line', () => {
    expect(wrapBubbleText('abcdefghijklmno', 6, 3, measure)).toEqual(['abcdef', 'ghijkl', 'mno']);
  });

  it('ends with an ellipsis after the third line', () => {
    const lines = wrapBubbleText('one two three four five six seven eight', 9, 3, measure);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(9);
  });

  it('counts an emoji as one character', () => {
    expect(wrapBubbleText('👋👋👋👋', 2, 3, measure)).toEqual(['👋👋', '👋👋']);
  });
});
