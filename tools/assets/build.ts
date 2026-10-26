// `pnpm assets:build`: art/export/* -> validated, optimised, budget-checked, content-hashed files in
// apps/web/public/assets/ plus assets-manifest.generated.json (docs/ART_PIPELINE.md Step 6).
//
//   --check         build everything in memory, write nothing (CI)
//   --placeholders  ignore the exports and write the generated placeholder set
//   --ci            over-budget fails the build (also when the CI env var is set)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AssetSourceManifest,
  type BuiltWardrobeItem,
  GeneratedAssetManifest,
} from '@shipfair/shared';
import { Contract } from './lib/contract.ts';
import { getIO } from './lib/io.ts';
import {
  type Ctx,
  processAnimations,
  processBoothKit,
  processCharacter,
  processProp,
} from './lib/kinds.ts';
import { PaletteFile, palettePng, writePaletteIfChanged } from './lib/palette.ts';
import { newReport, Sink } from './lib/sink.ts';
import { printSummary } from './lib/summary.ts';
import { type BodyInfo, longHairIds, processWardrobe } from './lib/wardrobe.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ART = join(ROOT, 'art');
const PUBLIC = join(ROOT, 'apps/web/public');
export const MANIFEST_FILE = 'assets-manifest.generated.json';

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

async function main(argv: readonly string[]): Promise<number> {
  const isCheck = argv.includes('--check');
  const isCi = argv.includes('--ci') || Boolean(process.env.CI);
  const started = performance.now();
  await getIO(); // meshopt encoder, decoder and simplifier WASM
  const contract = Contract.parse(readJson(join(ART, 'contract.json')));
  const manifest = AssetSourceManifest.parse(readJson(join(ART, 'manifest.json')));
  const ctx: Ctx = {
    contract,
    exportDir: join(ART, 'export'),
    sink: new Sink(),
    report: newReport(),
    usePlaceholders: argv.includes('--placeholders'),
  };

  const palette = PaletteFile.parse(readJson(join(ART, 'palette/palette.json')));
  const hex = palette.colors.map((c) => c.hex.toLowerCase());
  const png = palettePng(hex);
  const paletteUrl = ctx.sink.add('palette', 'png', png);

  const characters = [];
  const bodies = new Map<string, BodyInfo>();
  for (const entry of manifest.characters) {
    const result = await processCharacter(ctx, entry);
    characters.push(result.built);
    if (!result.built.isPlaceholder) bodies.set(entry.id, result);
  }
  const animations = await processAnimations(ctx, manifest.animations);
  const boothKit = await processBoothKit(ctx, manifest.boothKit);
  const props = [];
  for (const entry of manifest.props) props.push(await processProp(ctx, entry));
  const wardrobe: BuiltWardrobeItem[] = await processWardrobe(
    ctx,
    manifest.wardrobe,
    bodies,
    longHairIds(ART),
  );

  const generated = GeneratedAssetManifest.parse({
    version: 1,
    palette: { url: paletteUrl, hex },
    characters,
    animations,
    boothKit,
    props,
    wardrobe,
  });
  const json = `${JSON.stringify(generated, null, 2)}\n`;
  const { report, sink } = ctx;
  printSummary(generated, report, sink, performance.now() - started, isCi);

  if (!isCheck) {
    writePaletteIfChanged(join(ART, 'palette/palette.png'), png);
    const out = join(PUBLIC, 'assets');
    rmSync(out, { recursive: true, force: true });
    for (const [name, bytes] of sink.files) {
      mkdirSync(dirname(join(out, name)), { recursive: true });
      writeFileSync(join(out, name), bytes);
    }
    writeFileSync(join(out, MANIFEST_FILE), json);
    copyBasisTranscoder();
    mkdirSync(join(ART, 'reports'), { recursive: true });
    writeFileSync(join(ART, 'reports/assets-build.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  const isFailing = report.errors.length > 0 || (isCi && report.budget.length > 0);
  return isFailing ? 1 : 0;
}

/** The KTX2 transcoder is self-hosted next to the app, never fetched from a CDN. */
function copyBasisTranscoder(): void {
  const require = createRequire(join(ROOT, 'packages/engine/package.json'));
  const dir = join(PUBLIC, 'basis');
  mkdirSync(dir, { recursive: true });
  for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    copyFileSync(require.resolve(`three/examples/jsm/libs/basis/${file}`), join(dir, file));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
