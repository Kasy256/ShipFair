import { boothAnchor, districtAt, layoutCity, type PassportEvidence } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  at,
  setChatMinutes,
  TestClient,
  TestClock,
  tick,
  token,
  useClock,
  webCalls,
} from './test/client.ts';
import { USERS, WORLD } from './test/fixtures.ts';

// Passport evidence (prompt 13): what a shard reports with its stats batch. Time is stepped by
// hand, as in world-shard.test.ts.

const layout = layoutCity(WORLD.districts, WORLD.booths);
const BOOTH = WORLD.booths[0];
if (!BOOTH) throw new Error('fixture world has no booths');
const ANCHOR = boothAnchor(layout, BOOTH.id);
if (!ANCHOR) throw new Error('fixture booth has no lot');
const DISTRICT_ID = districtAt(layout, ANCHOR.x, ANCHOR.z)?.id;
const SLUG = WORLD.districts.find((d) => d.id === DISTRICT_ID)?.slug;
if (!SLUG) throw new Error('fixture booth is in no district');

async function shard(name: string): Promise<TestClock> {
  const clock = new TestClock();
  await useClock(name, clock);
  return clock;
}

async function placed(name: string, x: number, z: number, uid: string): Promise<TestClient> {
  const { client } = await TestClient.join(name, { token: await token(uid) });
  await move(client, x, z);
  return client;
}

async function move(client: TestClient, x: number, z: number): Promise<void> {
  client.send({ type: 'move', p: at(x, z), r: 0, a: 0, t: 0 });
  await client.barrier();
}

async function seconds(name: string, clock: TestClock, n: number): Promise<void> {
  for (let s = 0; s < n; s++) {
    clock.advance(1000);
    await tick(name);
  }
}

/** Evidence of every ingestStats call since the last read, sorted for comparison. */
async function evidence(): Promise<PassportEvidence[]> {
  const calls = (await webCalls()).filter((c) => c[0] === 'ingestStats');
  return calls
    .flatMap((c) => (c[1] as { evidence: PassportEvidence[] }).evidence)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const sorted = (rows: PassportEvidence[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

beforeEach(async () => {
  await webCalls();
  await setChatMinutes(0);
});

describe('passport evidence', () => {
  it('reports a district after 10 s of continuous dwell, not 9', async () => {
    const clock = await shard('w-301');
    const ada = await placed('w-301', ANCHOR.x, ANCHOR.z, USERS.ada);
    await tick('w-301');
    await seconds('w-301', clock, 9);
    clock.advance(30_000);
    await move(ada, 0, 0); // the plaza
    await tick('w-301');
    clock.advance(60_000);
    await tick('w-301');
    expect((await evidence()).filter((e) => e.kind === 'district')).toEqual([]);

    clock.advance(30_000);
    await move(ada, ANCHOR.x, ANCHOR.z);
    await tick('w-301');
    await seconds('w-301', clock, 11);
    clock.advance(60_000);
    await tick('w-301');
    expect((await evidence()).filter((e) => e.kind === 'district')).toEqual([
      { player: USERS.ada, kind: 'district', key: SLUG },
    ]);
  });

  it('reports booth visits, meeting the maker, a first chat and a shared shard', async () => {
    const clock = await shard('w-302');
    // Ada owns the booth and stands at it; Bob joins after her and visits.
    await placed('w-302', ANCHOR.x, ANCHOR.z, USERS.ada);
    const bob = await placed('w-302', ANCHOR.x, ANCHOR.z + 1, USERS.bob);
    await tick('w-302');
    await seconds('w-302', clock, 6);
    bob.send({ type: 'chat', text: 'Nice booth!' });
    await bob.barrier();
    clock.advance(60_000);
    await tick('w-302');

    const rows = await evidence();
    expect(rows.filter((e) => e.player === USERS.bob)).toEqual(
      sorted([
        { player: USERS.bob, kind: 'booth', key: BOOTH.id },
        { player: USERS.bob, kind: 'fact', key: 'met-a-maker' },
        { player: USERS.bob, kind: 'fact', key: 'first:chat' },
        { player: USERS.bob, kind: 'fact', key: 'squad' },
      ]),
    );
    // Ada visited her own booth (no maker to meet) and was first in the shard (no squad).
    expect(rows.filter((e) => e.player === USERS.ada)).toEqual([
      { player: USERS.ada, kind: 'booth', key: BOOTH.id },
    ]);
  });

  it('sends each fact once', async () => {
    const clock = await shard('w-303');
    const ada = await placed('w-303', ANCHOR.x, ANCHOR.z, USERS.ada);
    await tick('w-303');
    for (let stay = 0; stay < 2; stay++) {
      await seconds('w-303', clock, 6);
      clock.advance(5_000);
      await move(ada, ANCHOR.x, ANCHOR.z + 20);
      await tick('w-303');
      clock.advance(5_000);
      await move(ada, ANCHOR.x, ANCHOR.z);
      await tick('w-303');
    }
    clock.advance(60_000);
    await tick('w-303');
    expect((await evidence()).filter((e) => e.kind === 'booth')).toHaveLength(1);
  });
});
