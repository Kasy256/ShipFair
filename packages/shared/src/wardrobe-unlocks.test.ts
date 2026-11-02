import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNLOCKS } from './generated/wardrobe-ids.ts';

// The database refuses locked items on profile save from `wardrobe_unlocks`, seeded by
// migrations. The catalog's rules (`pnpm art:ids` → UNLOCKS) must match: a new unlock in
// art/config/wardrobe.json needs a migration that inserts it.

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

function sqlUnlocks(): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const insert of sql.matchAll(/insert into public\.wardrobe_unlocks[^;]*;/g)) {
      for (const [, id, rule] of insert[0].matchAll(/\('([a-z0-9_]+)', '([^']+)'\)/g)) {
        if (id && rule) rows[id] = rule;
      }
    }
  }
  return rows;
}

describe('wardrobe_unlocks', () => {
  it('matches the generated catalog rules', () => {
    expect(sqlUnlocks()).toEqual({ ...UNLOCKS });
  });
});
