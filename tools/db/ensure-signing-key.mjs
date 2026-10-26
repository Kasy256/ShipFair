// Creates supabase/signing_keys.json (one ES256 key) when it doesn't exist yet. config.toml points
// auth at it so local tokens are asymmetric and verifiable via JWKS, like staging and prod. Same
// JWK shape as `supabase gen signing-key`, which can't run here: it reads the configured file first.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keysPath = fileURLToPath(new URL('../../supabase/signing_keys.json', import.meta.url));

if (existsSync(keysPath)) {
  console.log('signing_keys.json exists');
} else {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = {
    ...privateKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    use: 'sig',
    key_ops: ['sign', 'verify'],
    alg: 'ES256',
    ext: true,
  };
  writeFileSync(keysPath, `${JSON.stringify([jwk], null, 2)}\n`);
  console.log('wrote supabase/signing_keys.json');
}
