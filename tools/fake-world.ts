// Prints a fake `/api/world` snapshot as JSON: `node tools/fake-world.ts [booths=500] [seed=1]`.
// The generator itself lives in @shipfair/shared (`@shipfair/shared/fake-world`) so the web
// shell's `?debug=fake500`, unit tests and e2e all build the same city.
import { fakeWorld } from '../packages/shared/test/fake-world.ts';

const [count = '500', seed = '1'] = process.argv.slice(2);
const booths = Number.parseInt(count, 10);
if (!Number.isInteger(booths) || booths < 0) throw new Error(`Bad booth count: ${count}`);
process.stdout.write(`${JSON.stringify(fakeWorld(booths, Number.parseInt(seed, 10) || 1))}\n`);
