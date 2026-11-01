// Word wrap for chat bubbles, pure so it is unit-tested without a canvas. `measure` returns a
// string's width in the bubble's font (CanvasRenderingContext2D.measureText in the engine).

const ELLIPSIS = '…';

/**
 * Splits `text` into at most `maxLines` lines no wider than `maxWidth`. Words longer than a line
 * are broken by character. If the text doesn't fit, the last line ends with an ellipsis.
 */
export function wrapBubbleText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  let line = '';
  const chars = (word: string) => Array.from(word);
  const push = (): boolean => {
    lines.push(line);
    line = '';
    return lines.length < maxLines;
  };
  let isCut = false;
  outer: for (const word of text.split(' ')) {
    if (word === '') continue;
    const candidate = line === '' ? word : `${line} ${word}`;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '' && !push()) {
      isCut = true;
      break;
    }
    // The word starts a new line; break it by character if it is wider than a line.
    for (const ch of chars(word)) {
      if (measure(line + ch) > maxWidth && line !== '') {
        if (!push()) {
          isCut = true;
          break outer;
        }
      }
      line += ch;
    }
  }
  if (!isCut && line !== '') lines.push(line);
  if (isCut || lines.length > maxLines) {
    lines.length = Math.min(lines.length, maxLines);
    let last = lines[lines.length - 1] ?? '';
    while (last !== '' && measure(last + ELLIPSIS) > maxWidth)
      last = chars(last).slice(0, -1).join('');
    lines[lines.length - 1] = `${last.trimEnd()}${ELLIPSIS}`;
  }
  return lines;
}
