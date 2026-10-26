import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { readGlb, writeGlb } from './io.ts';
import { validateGlb } from './validate.ts';

export const PUBLIC_PREFIX = '/assets/';
const HASH_CHARS = 10;

/** Collects content-hashed output files in memory; build.ts writes them (or not, for --check). */
export class Sink {
  readonly files = new Map<string, Uint8Array>();

  /** `characters/body_superhero_m` + bytes -> `/assets/characters/body_superhero_m.<hash>.glb`. */
  add(base: string, ext: string, bytes: Uint8Array): string {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, HASH_CHARS);
    const name = `${base}.${hash}.${ext}`;
    this.files.set(name, bytes);
    return `${PUBLIC_PREFIX}${name}`;
  }

  async addGlb(base: string, doc: Document): Promise<{ url: string; bytes: number }> {
    const bytes = await writeGlb(doc);
    return { url: this.add(base, 'glb', bytes), bytes: bytes.length };
  }
}

export interface Report {
  errors: string[];
  warnings: string[];
  /** Over-budget lines: errors in CI, warnings locally. */
  budget: string[];
  /** Measurements worth printing (worst-case avatars, LOD ratios). */
  info: string[];
}

export const newReport = (): Report => ({ errors: [], warnings: [], budget: [], info: [] });

const LFS_POINTER = 'version https://git-lfs';

/**
 * Reads, validates and parses one export. Returns null (with a warning) when the file is missing
 * or is still a Git LFS pointer, so the caller writes a placeholder instead.
 */
export async function loadSource(
  exportDir: string,
  path: string,
  report: Report,
  usePlaceholders: boolean,
): Promise<Document | null> {
  if (usePlaceholders) return null;
  const file = join(exportDir, path);
  if (!existsSync(file)) {
    report.warnings.push(`${path}: not exported yet; using the generated placeholder`);
    return null;
  }
  const bytes = readFileSync(file);
  if (bytes.subarray(0, LFS_POINTER.length).toString('utf8') === LFS_POINTER) {
    report.warnings.push(`${path}: is a Git LFS pointer (run git lfs pull); using the placeholder`);
    return null;
  }
  const { errors } = await validateGlb(path, bytes);
  report.errors.push(...errors);
  if (errors.length > 0) return null;
  return readGlb(bytes);
}
