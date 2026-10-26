// `pnpm assets:palette`: art/palette/palette.json -> palette.png (4×4 squares, 256×256). Edit only
// the JSON; `pnpm assets:build` regenerates the PNG too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './build.ts';
import { PaletteFile, palettePng, writePaletteIfChanged } from './lib/palette.ts';

const dir = join(ROOT, 'art/palette');
const palette = PaletteFile.parse(JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8')));
const png = palettePng(palette.colors.map((c) => c.hex));
const isWritten = writePaletteIfChanged(join(dir, 'palette.png'), png);
console.log(
  `art/palette/palette.png: ${isWritten ? 'written' : 'already up to date'} (${palette.colors.length} colours)`,
);
