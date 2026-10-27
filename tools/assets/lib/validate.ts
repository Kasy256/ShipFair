import { validateBytes } from 'gltf-validator';

const ERROR = 0;
const MAX_LISTED = 5;

/** Runs the Khronos validator. Every error is a problem; warnings are only counted. */
export async function validateGlb(
  file: string,
  bytes: Uint8Array,
): Promise<{ errors: string[]; warnings: number }> {
  const report = await validateBytes(bytes, { uri: file, maxIssues: 200 });
  const errors = report.issues.messages
    .filter((m) => m.severity === ERROR)
    .slice(0, MAX_LISTED)
    .map((m) => `${file}: glTF validator ${m.code} at ${m.pointer ?? '/'}: ${m.message}`);
  const more = report.issues.numErrors - errors.length;
  if (more > 0) errors.push(`${file}: …and ${more} more validator errors`);
  return { errors, warnings: report.issues.numWarnings };
}
