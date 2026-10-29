import { Font } from 'three/addons/loaders/FontLoader.js';

// A tiny block typeface made in code for the plaza's brand letters. The prototype used three's
// helvetiker_bold JSON, which npm's `three` no longer ships; drawing our own 5×7 glyphs avoids a
// third-party font licence and ~60 KB of JSON. Each lit run of cells becomes one rectangle in
// the glyph outline, so TextGeometry extrudes and bevels it like any other font.

// biome-ignore format: glyph bitmaps read best as 7 rows of 5 cells
const GLYPHS: Readonly<Record<string, string>> = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...#####.#...##...##...#####.',
  C: '.###.#...##....#....#....#...#.###.', D: '####.#...##...##...##...##...#####.',
  E: '######....####.#....#....#....#####', F: '######....####.#....#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...#######...##...##...##...#',
  I: '#####..#....#....#....#....#..#####', J: '..###...#....#....#.#..#.#..#..##..',
  K: '#...##..#.###..#.#..#..#.#...##...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##...##...##...##...#', N: '#...###..##.#.##..###...##...##...#',
  O: '.###.#...##...##...##...##...#.###.', P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.', V: '#...##...##...##...#.#.#..#.#...#..',
  W: '#...##...##...##.#.##.#.###.###...#', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#..#####',
  '2': '.###.#...#....#...#...#...#...#####', '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....#....#####.',
  '6': '.###.#....#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#....#.###.',
  '&': '.##..#..#.#.#...#...#.#.##..#..##.#', '.': '..............................##...',
  '-': '................###................', ' ': '...................................',
};

const COLUMNS = 5;
const ROWS = 7;
/** Font units per cell; the font's resolution is one glyph height. */
const CELL = 100;
const ADVANCE = (COLUMNS + 1) * CELL;

/** The outline of one glyph as FontLoader path commands (clockwise rectangles = solid). */
function outline(bits: string): string {
  const parts: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const y1 = (ROWS - row) * CELL;
    const y0 = y1 - CELL;
    let col = 0;
    while (col < COLUMNS) {
      if (bits[row * COLUMNS + col] !== '#') {
        col++;
        continue;
      }
      const start = col;
      while (col < COLUMNS && bits[row * COLUMNS + col] === '#') col++;
      const x0 = start * CELL;
      const x1 = col * CELL;
      parts.push(`m ${x0} ${y0} l ${x0} ${y1} l ${x1} ${y1} l ${x1} ${y0} z`);
    }
  }
  return parts.join(' ');
}

let font: Font | undefined;

/** The block font (built once). Characters it lacks render as spaces. */
export function blockFont(): Font {
  if (font) return font;
  const glyphs: Record<string, { ha: number; x_min: number; x_max: number; o: string }> = {};
  for (const [char, bits] of Object.entries(GLYPHS)) {
    glyphs[char] = { ha: ADVANCE, x_min: 0, x_max: COLUMNS * CELL, o: outline(bits) };
  }
  font = new Font({
    glyphs,
    familyName: 'ShipFair Block',
    ascender: ROWS * CELL,
    descender: 0,
    underlinePosition: -CELL,
    original_font_information: { license: 'Drawn in code for ShipFair' },
    resolution: ROWS * CELL,
    boundingBox: { xMin: 0, xMax: COLUMNS * CELL, yMin: 0, yMax: ROWS * CELL },
    underlineThickness: CELL,
  });
  return font;
}

/** `text` upper-cased with unsupported characters replaced by spaces. */
export function blockText(text: string): string {
  let out = '';
  for (const char of text.toUpperCase()) out += GLYPHS[char] ? char : ' ';
  return out;
}
