// Pure parts of the art runner: config parsing, Blender discovery and argument building.
// Kept free of side effects so they can be unit tested without Blender.
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export const MIN_BLENDER = { major: 3, minor: 6 } as const;
export const QUIET_WARN_S = 10;

export const STEPS = [
  { name: 'inspect', script: 'inspect.py', needsPacks: [] },
  { name: 'characters', script: 'characters.py', needsPacks: ['universal-base-characters'] },
  { name: 'animations', script: 'animations.py', needsPacks: ['universal-animation-library'] },
  { name: 'wardrobe', script: 'wardrobe.py', needsPacks: [] },
  { name: 'hair', script: 'hair.py', needsPacks: [] },
  { name: 'booth-kit', script: 'booth_kit.py', needsPacks: [] },
  { name: 'props', script: 'props.py', needsPacks: [] },
  { name: 'previews', script: 'previews.py', needsPacks: [] },
] as const;

export type StepName = (typeof STEPS)[number]['name'];

export const envSchema = z.object({
  BLENDER_PATH: z.string().min(1).optional(),
  ART_PACKS_DIR: z.string().min(1).optional(),
});

export const stepResultSchema = z.object({
  step: z.string(),
  ok: z.boolean(),
  skipped: z.boolean(),
  seconds: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  stats: z.record(z.string(), z.unknown()),
});

export type StepResult = z.infer<typeof stepResultSchema>;

export interface ArtPaths {
  readonly repoRoot: string;
  readonly packsDir: string;
  readonly exportDir: string;
  readonly reportsDir: string;
  readonly previewsDir: string;
}

export function artPaths(repoRoot: string, packsEnv: string | undefined): ArtPaths {
  const art = join(repoRoot, 'art');
  const packs = packsEnv ?? join(art, 'packs');
  return {
    repoRoot,
    packsDir: isAbsolute(packs) ? packs : resolve(repoRoot, packs),
    exportDir: join(art, 'export'),
    reportsDir: join(art, 'reports'),
    previewsDir: join(art, 'previews'),
  };
}

/** Parses `blender --version` output, e.g. "Blender 3.6.23 (hash ...)". */
export function parseBlenderVersion(output: string): { major: number; minor: number } | null {
  const m = /Blender\s+(\d+)\.(\d+)/.exec(output);
  if (!m?.[1] || !m[2]) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function isSupportedVersion(v: { major: number; minor: number }): boolean {
  return (
    v.major > MIN_BLENDER.major || (v.major === MIN_BLENDER.major && v.minor >= MIN_BLENDER.minor)
  );
}

/** Common install locations, newest LTS first, used when BLENDER_PATH is unset. */
export function blenderCandidates(platform: NodeJS.Platform): string[] {
  const versions = ['4.5', '4.4', '4.3', '4.2', '4.1', '4.0', '3.6'];
  if (platform === 'win32') {
    const roots = [
      'C:\\Program Files\\Blender Foundation',
      'C:\\Program Files (x86)\\Blender Foundation',
    ];
    return roots.flatMap((r) => versions.map((v) => `${r}\\Blender ${v}\\blender.exe`));
  }
  if (platform === 'darwin') return ['/Applications/Blender.app/Contents/MacOS/Blender'];
  return ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
}

export function findBlender(
  env: z.infer<typeof envSchema>,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (env.BLENDER_PATH) return exists(env.BLENDER_PATH) ? env.BLENDER_PATH : null;
  return blenderCandidates(platform).find((p) => exists(p)) ?? null;
}

export const HOW_TO_SET_BLENDER = [
  'Blender 3.6 LTS or newer was not found. Set BLENDER_PATH to the full path of the executable:',
  '  PowerShell (persists): [Environment]::SetEnvironmentVariable("BLENDER_PATH", "C:\\path\\to\\blender.exe", "User")',
  '  Git Bash / macOS / Linux: export BLENDER_PATH="/path/to/blender"',
  'Then open a new terminal and run the command again.',
].join('\n');

/** Argument array for one step. Never joined into a shell string, so spaces and brackets are safe. */
export function blenderArgs(scriptPath: string, payload: Record<string, string>): string[] {
  return [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    scriptPath,
    '--',
    JSON.stringify(payload),
  ];
}
