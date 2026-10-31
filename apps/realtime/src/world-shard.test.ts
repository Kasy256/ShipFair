import { evictDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import {
  AvatarStyle,
  boothAnchor,
  encodeClient,
  encodeServer,
  guestName,
  layoutCity,
  migrateAvatarStyle,
  type SnapEntry,
  spawnForBooth,
} from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLOSE } from './limits.ts';
import {
  AVATAR,
  at,
  guestId,
  hello,
  playerCount,
  setChatMinutes,
  shardStub,
  TestClient,
  TestClock,
  tick,
  token,
  useClock,
  webCalls,
} from './test/client.ts';
import { USERS, WORLD } from './test/fixtures.ts';

// WorldShard behaviour through real WebSockets. Each test uses its own shard name; time and the
// 10 Hz loop are stepped by hand (TICK_MODE=manual, `useClock`, `tick`), never waited for.

const layout = layoutCity(WORLD.districts, WORLD.booths);
const BOOTH = WORLD.booths[0];
if (!BOOTH) throw new Error('fixture world has no booths');
const ANCHOR = boothAnchor(layout, BOOTH.id);
if (!ANCHOR) throw new Error('fixture booth has no lot');

/** A shard with a fresh clock; returns the clock. */
async function shard(name: string): Promise<TestClock> {
  const clock = new TestClock();
  await useClock(name, clock);
  return clock;
}

/** Joins and places the player at (x, z) with its first move (deep links place freely). */
async function placed(
  name: string,
  x: number,
  z: number,
  extra?: Parameters<typeof TestClient.join>[1],
): Promise<{ client: TestClient; id: number }> {
  const { client, welcome } = await TestClient.join(name, extra);
  client.send({ type: 'move', p: at(x, z), r: 0, a: 0, t: 0 });
  await client.barrier();
  return { client, id: welcome.you };
}

/** Sends a move and waits until the server has handled it (so the clock it read is the current one). */
async function move(client: TestClient, x: number, z: number, r = 0, a = 0): Promise<void> {
  client.send({ type: 'move', p: at(x, z), r, a, t: 0 });
  await client.barrier();
}

const ingestCalls = async () => (await webCalls()).filter((c) => c[0] === 'ingestStats');

beforeEach(async () => {
  await webCalls(); // clear
  await setChatMinutes(0);
});

describe('hello', () => {
  it('lets a guest in under the server-derived name, ignoring any name the client sends', async () => {
    await shard('w-101');
    const { client: watcher } = await placed('w-101', 0, 0);
    const id = guestId();
    const client = await TestClient.connect('w-101');
    // A forged field: the schema strips it and the server derives the name from the guest id.
    client.sendRaw(encodeClient({ ...hello({ guestId: id }), name: 'Admin' } as never));
    const welcome = await client.next('welcome');
    expect(welcome.shard).toBe('w-101');
    expect(welcome.players).toHaveLength(1);
    await tick('w-101');
    const join = await watcher.next('join');
    expect(join.player).toMatchObject({ id: welcome.you, name: guestName(id), isGuest: true });
    expect(join.player.uid).toBeUndefined();
  });

  it('relays the v2 look, and migrates the flat tints of a protocol-v1 client', async () => {
    await shard('w-109');
    const { client: watcher } = await placed('w-109', 0, 0);
    const look = { ...AVATAR, skin: 2, top: { ...AVATAR.top, color: 11 } };
    const { welcome: v2 } = await TestClient.join('w-109', { guestId: guestId(), avatar: look });
    await tick('w-109');
    expect((await watcher.next('join')).player).toMatchObject({ id: v2.you, avatar: look });
    const v1 = AvatarStyle.parse({ top: '#ef4444' });
    const { welcome: old } = await TestClient.join('w-109', {
      v: 1,
      guestId: guestId(),
      avatar: v1,
    });
    await tick('w-109');
    const join = await watcher.next('join');
    expect(join.player.id).toBe(old.you);
    expect(join.player.avatar).toEqual(migrateAvatarStyle(v1));
  });

  it('accepts a valid Supabase JWT and shows the profile name and uid', async () => {
    await shard('w-102');
    const { client: watcher } = await placed('w-102', 0, 0);
    const { welcome } = await TestClient.join('w-102', { token: await token(USERS.ada) });
    await tick('w-102');
    const join = await watcher.next('join');
    expect(join.player).toMatchObject({
      id: welcome.you,
      name: 'Ada',
      isGuest: false,
      uid: USERS.ada,
    });
  });

  it('refuses an expired JWT', async () => {
    await shard('w-103');
    const client = await TestClient.connect('w-103');
    client.send(hello({ token: await token(USERS.ada, -60) }));
    expect((await client.notice('kicked')).message).toMatch(/expired/);
    expect((await client.waitClosed()).code).toBe(CLOSE.unauthorized);
  });

  it('refuses a token not signed by the project key', async () => {
    await shard('w-103');
    const client = await TestClient.connect('w-103');
    const [head, body] = (await token(USERS.ada)).split('.');
    client.send(hello({ token: `${head}.${body}.AAAA` }));
    await client.notice('kicked');
    expect((await client.waitClosed()).code).toBe(CLOSE.unauthorized);
  });

  it('refuses a banned user, and reads the ban on every hello (never cached)', async () => {
    await shard('w-104');
    const banned = await TestClient.connect('w-104');
    banned.send(hello({ token: await token(USERS.banned) }));
    await banned.notice('banned');
    expect((await banned.waitClosed()).code).toBe(CLOSE.banned);

    await webCalls();
    await TestClient.join('w-104', { token: await token(USERS.ada) });
    await TestClient.join('w-104', { token: await token(USERS.ada) });
    const lookups = (await webCalls()).filter((c) => c[0] === 'getPlayer');
    // Both hellos asked; the second skipped the (cached) profile but still read the ban.
    expect(lookups).toEqual([
      ['getPlayer', USERS.ada, true],
      ['getPlayer', USERS.ada, false],
    ]);
  });

  it('refuses a signed-in user without a profile', async () => {
    await shard('w-105');
    const client = await TestClient.connect('w-105');
    client.send(hello({ token: await token(USERS.noProfile) }));
    await client.notice('kicked');
    expect((await client.waitClosed()).code).toBe(CLOSE.unauthorized);
  });

  it('turns players away from a full shard with a suggested one', async () => {
    await shard('w-106');
    for (let i = 0; i < 4; i++) await TestClient.join('w-106'); // MAX_PLAYERS_PER_SHARD=4 in tests
    const late = await TestClient.connect('w-106');
    late.send(hello({ guestId: guestId() }));
    const full = await late.notice('shard_full');
    expect(full.data.shard).toMatch(/^w-\d+$/);
    expect(full.data.shard).not.toBe('w-106');
    expect((await late.waitClosed()).code).toBe(CLOSE.shardFull);
    expect(await playerCount('w-106')).toBe(4);
  });

  it('asks clients older than MIN_CLIENT_PROTOCOL to update', async () => {
    await shard('w-107');
    const client = await TestClient.connect('w-107');
    client.send({ ...hello({ guestId: guestId() }), v: 0 } as never);
    await client.notice('update_required');
    expect((await client.waitClosed()).code).toBe(CLOSE.updateRequired);
  });

  it('drops messages sent before hello, then accepts the hello', async () => {
    await shard('w-108');
    const client = await TestClient.connect('w-108');
    client.send({ type: 'move', p: at(1, 1), r: 0, a: 0, t: 0 });
    client.send(hello({ guestId: guestId() }));
    await client.next('welcome');
    expect(client.take('notice')).toEqual([]);
  });

  it('closes a socket that never says hello', async () => {
    const clock = await shard('w-109');
    const client = await TestClient.connect('w-109');
    await tick('w-109');
    expect(client.closed).toBeNull();
    clock.advance(11_000);
    await tick('w-109');
    expect((await client.waitClosed()).code).toBe(CLOSE.helloTimeout);
  });
});

describe('invalid messages', () => {
  it('counts and drops them, and closes the socket at 20 within 10 s', async () => {
    await shard('w-111');
    const { client } = await TestClient.join('w-111');
    for (let i = 0; i < 18; i++) client.sendRaw(new Uint8Array([0xc1])); // never valid msgpack
    client.sendRaw('text frames are invalid too');
    await client.barrier();
    expect(client.closed).toBeNull();
    client.sendRaw(new Uint8Array([0x93, 1, 2])); // valid msgpack, not a message
    expect((await client.waitClosed()).code).toBe(CLOSE.invalid);
  });

  it('answers ping with pong', async () => {
    await shard('w-112');
    const { client } = await TestClient.join('w-112');
    client.send({ type: 'ping', t: 1234 });
    expect(await client.next('pong')).toEqual({ type: 'pong', t: 1234 });
  });
});

describe('move', () => {
  it('accepts speeds within the limit and corrects a teleport hack', async () => {
    const clock = await shard('w-121');
    const { client } = await placed('w-121', 0, 0);

    clock.advance(100);
    await move(client, 0.6, 0, 100, 1); // 6 m/s: run speed
    clock.advance(1000);
    await move(client, 10.5, 0, 100, 1); // 9.9 m in 1 s, under the 10.5 m limit
    expect(client.take('notice')).toEqual([]);

    clock.advance(100);
    client.send({ type: 'move', p: at(40, 0), r: 0, a: 0, t: 999_999 }); // 29.5 m in 0.1 s
    const correct = await client.notice('correct');
    expect(correct.data).toEqual({ p: at(10.5, 0), r: 100 });
  });

  it('uses server receive time, not the client t', async () => {
    const clock = await shard('w-122');
    const { client } = await placed('w-122', 0, 0);
    clock.advance(100);
    // The client claims a whole minute passed; the server saw 0.1 s.
    client.send({ type: 'move', p: at(20, 0), r: 0, a: 0, t: 60_000 });
    await client.notice('correct');
  });

  it('corrects moves outside the city bounds', async () => {
    const clock = await shard('w-123');
    const { client } = await placed('w-123', 60, 0);
    clock.advance(1000);
    client.send({ type: 'move', p: at(68, 0), r: 0, a: 0, t: 0 }); // reachable, but past the edge
    expect((await client.notice('correct')).data.p).toEqual(at(60, 0));
  });

  it('rate-limits moves to a burst of 15 at 12/s', async () => {
    const clock = await shard('w-124');
    const { client } = await placed('w-124', 0, 0); // that move spent one token
    clock.advance(1000); // refill to 15
    for (let i = 1; i <= 20; i++)
      client.send({ type: 'move', p: at(i * 0.01, 0), r: 0, a: 0, t: 0 });
    await client.barrier();
    // The 15th move (x = 0.15 m) was the last one accepted.
    const { welcome } = await TestClient.join('w-124');
    expect(welcome.players.map((p) => p.p)).toEqual([at(0.15, 0)]);
  });
});

describe('teleport', () => {
  it('moves the player to the booth spawn the client also uses', async () => {
    const clock = await shard('w-125');
    const spawn = spawnForBooth(layout, BOOTH.id);
    if (!spawn) throw new Error('no spawn');
    const { client: watcher } = await placed('w-125', spawn.x, spawn.z + 10);
    const { client, id } = await placed('w-125', 0, -20);
    await tick('w-125');
    watcher.take('join');
    client.send({ type: 'teleport', to: { kind: 'booth', slug: BOOTH.slug } });
    await client.barrier();
    await tick('w-125');
    const snap = await watcher.next('snap');
    expect(snap.s.find((e) => e[0] === id)?.slice(1, 4)).toEqual(at(spawn.x, spawn.z));
    clock.advance(100);
    client.send({ type: 'move', p: at(spawn.x + 0.5, spawn.z), r: 0, a: 0, t: 0 });
    await client.barrier();
    expect(client.take('notice')).toEqual([]);
  });

  it('ignores an unknown target', async () => {
    const clock = await shard('w-126');
    const { client } = await placed('w-126', 0, 0);
    client.send({ type: 'teleport', to: { kind: 'district', slug: 'no-such-place' } });
    clock.advance(100);
    client.send({ type: 'move', p: at(0, 45), r: 0, a: 0, t: 0 });
    await client.notice('correct');
  });
});

describe('area of interest', () => {
  it('relays players within 60 m only: B at 50 m from A sees A, C at 100 m sees nobody', async () => {
    const clock = await shard('w-131');
    const a = await placed('w-131', -30, -55);
    const b = await placed('w-131', -30, -5); // 50 m from A
    const c = await placed('w-131', 50, 5); // 100 m from A, 80.6 m from B
    await tick('w-131');
    expect((await a.client.next('join')).player.id).toBe(b.id);
    expect((await b.client.next('join')).player.id).toBe(a.id);
    // C's welcome was computed at the plaza spawn; after its first move B left C's view.
    await c.client.barrier();
    expect(c.client.take('leave').map((m) => m.id)).toEqual([b.id]);
    expect(c.client.take('join')).toEqual([]);
    c.client.inbox.length = 0;
    a.client.take('join');
    b.client.take('join');

    clock.advance(100);
    await move(a.client, -30, -54.5, 7, 2);
    await tick('w-131');
    const snap = await b.client.next('snap');
    expect(snap.s).toEqual([[a.id, ...at(-30, -54.5), 7, 2] satisfies SnapEntry]);
    await c.client.barrier();
    expect(c.client.inbox.filter((m) => m.type !== 'pong')).toEqual([]);
  });

  it('sends only players that changed, and leave when one walks out of range', async () => {
    const clock = await shard('w-132');
    const a = await placed('w-132', 0, 0);
    const b = await placed('w-132', 10, 0);
    await tick('w-132');
    a.client.take('join');
    b.client.take('join');
    await tick('w-132'); // nothing moved
    await a.client.barrier();
    expect(a.client.take('snap')).toEqual([]);

    // B walks 72 m away in steps the clamp accepts.
    for (let x = 18; x <= 58; x += 8) {
      clock.advance(1000);
      await move(b.client, x, 0);
    }
    for (let z = 8; z <= 40; z += 8) {
      clock.advance(1000);
      await move(b.client, 60, z);
    }
    expect(b.client.take('notice')).toEqual([]);
    await tick('w-132');
    expect((await a.client.next('leave')).id).toBe(b.id);
  });

  it('encodes snaps compactly: cm ints and uint16 yaw, a few bytes per player', async () => {
    const clock = await shard('w-133');
    const watcher = await placed('w-133', 0, 0);
    const movers = [
      await placed('w-133', 3, 3),
      await placed('w-133', -3, 3),
      await placed('w-133', 3, -3),
    ];
    await tick('w-133');
    watcher.client.take('join');
    clock.advance(100);
    const starts = [
      [3, 3],
      [-3, 3],
      [3, -3],
    ] as const;
    for (const [i, m] of movers.entries()) {
      const [x, z] = starts[i] ?? [0, 0];
      await move(m.client, x + 0.25, z + 0.5, 65535, 3);
    }
    await tick('w-133');
    const snap = await watcher.client.next('snap');
    expect(snap.s).toHaveLength(3);
    for (const entry of snap.s) {
      for (const n of entry) expect(Number.isInteger(n)).toBe(true);
      expect(entry[4]).toBe(65535);
    }
    // Three changed players: a fixmap header, `type`, `t` and `s`, then 6 small ints each.
    expect(encodeServer(snap).byteLength).toBeLessThan(80);
  });
});

describe('emote', () => {
  it('relays within the AOI at most once a second', async () => {
    const clock = await shard('w-141');
    const a = await placed('w-141', 0, 0);
    const b = await placed('w-141', 5, 0);
    a.client.send({ type: 'emote', e: 3 });
    a.client.send({ type: 'emote', e: 4 }); // same second: dropped
    await a.client.barrier();
    await b.client.barrier();
    expect(b.client.take('emote')).toEqual([{ type: 'emote', id: a.id, e: 3 }]);
    clock.advance(1000);
    a.client.send({ type: 'emote', e: 5 });
    expect(await b.client.next('emote')).toEqual({ type: 'emote', id: a.id, e: 5 });
  });
});

describe('chat', () => {
  async function chatters(name: string) {
    const clock = await shard(name);
    const ada = await placed(name, 0, 0, { token: await token(USERS.ada) });
    const bob = await placed(name, 5, 0, { token: await token(USERS.bob) });
    return { clock, ada, bob };
  }

  it('blocks guests', async () => {
    const { bob } = await chatters('w-151');
    const guest = await placed('w-151', 2, 0);
    guest.client.send({ type: 'chat', text: 'hello from a guest' });
    await guest.client.barrier();
    await bob.client.barrier();
    expect(bob.client.take('chat')).toEqual([]);
  });

  it('relays to players within 15 m, including the sender, de-linked', async () => {
    const { ada, bob } = await chatters('w-152');
    const far = await placed('w-152', 0, 20, { token: await token(USERS.newbie) });
    ada.client.send({ type: 'chat', text: '  see https://evil.com/x  ok ' });
    const heard = await bob.client.next('chat');
    expect(heard).toMatchObject({ id: ada.id, text: 'see evil[.]com/x ok' });
    expect((await ada.client.next('chat')).text).toBe('see evil[.]com/x ok');
    await far.client.barrier();
    expect(far.client.take('chat')).toEqual([]);
  });

  it('rate-limits to a burst of 3, then one per 1.5 s', async () => {
    const { clock, ada, bob } = await chatters('w-153');
    for (let i = 1; i <= 4; i++) ada.client.send({ type: 'chat', text: `message ${i}` });
    await ada.client.barrier();
    await bob.client.barrier();
    expect(bob.client.take('chat').map((m) => m.text)).toEqual([
      'message 1',
      'message 2',
      'message 3',
    ]);
    clock.advance(1500);
    ada.client.send({ type: 'chat', text: 'message 5' });
    expect((await bob.client.next('chat')).text).toBe('message 5');
  });

  it('stars out profanity and mutes after 3 filtered messages in 5 minutes', async () => {
    const { clock, ada, bob } = await chatters('w-154');
    ada.client.send({ type: 'chat', text: 'what the fuck' });
    expect((await bob.client.next('chat')).text).toBe('what the ★★★★');
    clock.advance(2000);
    ada.client.send({ type: 'chat', text: 'fuck this' });
    clock.advance(2000);
    ada.client.send({ type: 'chat', text: 'oh fuck' });
    const muted = await ada.client.notice('muted');
    expect(muted.data.until).toBe(clock.now + 10 * 60_000);
    await bob.client.barrier();
    bob.client.take('chat');

    clock.advance(2000);
    ada.client.send({ type: 'chat', text: 'can anyone hear me' });
    await ada.client.notice('muted');
    await bob.client.barrier();
    expect(bob.client.take('chat')).toEqual([]);

    clock.advance(10 * 60_000);
    ada.client.send({ type: 'chat', text: 'back again' });
    expect((await bob.client.next('chat')).text).toBe('back again');
  });

  it('holds back accounts younger than NEW_ACCOUNT_CHAT_MINUTES', async () => {
    await setChatMinutes(30);
    // The stub creates the newbie's account "now" in real time, so this shard runs on real time.
    const clock = new TestClock(Date.now());
    await useClock('w-155', clock);
    const newbie = await placed('w-155', 0, 0, { token: await token(USERS.newbie) });
    const ada = await placed('w-155', 3, 0, { token: await token(USERS.ada) });
    await tick('w-155'); // loads the flags
    newbie.client.send({ type: 'chat', text: 'first post' });
    expect((await newbie.client.notice('muted')).data.until).toBeGreaterThan(Date.now());
    ada.client.send({ type: 'chat', text: 'old account' });
    expect((await newbie.client.next('chat')).text).toBe('old account');
    clock.advance(31 * 60_000);
    newbie.client.send({ type: 'chat', text: 'second try' });
    expect((await ada.client.next('chat', (m) => m.id === newbie.id)).text).toBe('second try');
  });
});

describe('hibernation', () => {
  it('rebuilds every player from socket attachments after the object is evicted', async () => {
    const clock = await shard('w-161');
    const a = await placed('w-161', 0, 0);
    const b = await placed('w-161', 6, 0);
    await tick('w-161');
    a.client.take('join');
    b.client.take('join');

    await evictDurableObject(shardStub('w-161'));
    await useClock('w-161', clock); // the new instance has a fresh clock field

    // The next frame wakes the object; onStart rebuilds the room from the sockets first.
    clock.advance(500);
    await move(a.client, 2, 0, 9, 1);
    expect(await playerCount('w-161')).toBe(2);
    await tick('w-161');
    // B sees A at the new position (as a join: who-sees-whom is rebuilt from scratch).
    const seen = await b.client.next('join');
    expect(seen.player).toMatchObject({ id: a.id, p: at(2, 0), r: 9 });

    // The last accepted move survived too: a jump from there is still corrected.
    clock.advance(100);
    a.client.send({ type: 'move', p: at(30, 0), r: 0, a: 0, t: 0 });
    expect((await a.client.notice('correct')).data.p).toEqual(at(2, 0));
    expect(a.client.take('notice')).toEqual([]);
  });
});

describe('visit tracking', () => {
  it('counts a visit only after 5 s within 6 m, and reports once a minute', async () => {
    const clock = await shard('w-171');
    const { client } = await placed('w-171', ANCHOR.x, ANCHOR.z + 7, {
      token: await token(USERS.ada),
    });
    await tick('w-171');
    // 10 s at 7 m: too far.
    for (let s = 0; s < 10; s++) {
      clock.advance(1000);
      await tick('w-171');
    }
    // 4 s within range, then away: too short.
    clock.advance(1000);
    await move(client, ANCHOR.x, ANCHOR.z + 2);
    for (let s = 0; s < 4; s++) {
      clock.advance(1000);
      await tick('w-171');
    }
    clock.advance(1000);
    await move(client, ANCHOR.x, ANCHOR.z + 9);
    await tick('w-171');
    // Back for 6 s: one visit.
    clock.advance(1000);
    await move(client, ANCHOR.x, ANCHOR.z + 1);
    for (let s = 0; s < 6; s++) {
      clock.advance(1000);
      await tick('w-171');
    }
    expect(await ingestCalls()).toEqual([]);

    clock.advance(60_000);
    await tick('w-171');
    const calls = await ingestCalls();
    expect(calls).toEqual([
      [
        'ingestStats',
        {
          shard: 'w-171',
          secret: 'test-stats-secret',
          rows: [{ boothId: BOOTH.id, day: '2026-10-31', visits: 1, uniqueVisitors: 1 }],
        },
      ],
    ]);

    // Still standing there: no new visit, and no call until the next minute anyway.
    for (let s = 0; s < 30; s++) {
      clock.advance(1000);
      await tick('w-171');
    }
    expect(await ingestCalls()).toEqual([]);
  });

  it('counts a second stay as a visit but not as a new unique visitor', async () => {
    const clock = await shard('w-172');
    const { client } = await placed('w-172', ANCHOR.x, ANCHOR.z, { token: await token(USERS.ada) });
    await tick('w-172');
    for (let stay = 0; stay < 2; stay++) {
      for (let s = 0; s < 6; s++) {
        clock.advance(1000);
        await tick('w-172');
      }
      clock.advance(1000);
      await move(client, ANCHOR.x, ANCHOR.z + (stay === 0 ? 10 : 0));
      await tick('w-172');
      clock.advance(1000);
      await move(client, ANCHOR.x, ANCHOR.z);
      await tick('w-172');
    }
    clock.advance(60_000);
    await tick('w-172');
    const [call] = await ingestCalls();
    expect((call?.[1] as { rows: unknown[] } | undefined)?.rows).toEqual([
      { boothId: BOOTH.id, day: '2026-10-31', visits: 2, uniqueVisitors: 1 },
    ]);
  });
});

describe('population, kicks and world updates', () => {
  it('pushes shard and global totals every 30 s', async () => {
    const clock = await shard('w-181');
    const { client } = await placed('w-181', 0, 0);
    await tick('w-181');
    expect(client.take('notice').filter((n) => n.code === 'population')).toEqual([]);
    clock.advance(30_000);
    await tick('w-181');
    const population = await client.notice('population');
    expect(population.data.shard).toBe(1);
    expect(population.data.total).toBeGreaterThanOrEqual(1);
  });

  it('RealtimeRpc.kick closes the banned user on every shard', async () => {
    await shard('w-182');
    const ada = await placed('w-182', 0, 0, { token: await token(USERS.ada) });
    const bob = await placed('w-182', 2, 0, { token: await token(USERS.bob) });
    await tick('w-182'); // reports the shard to the coordinator
    expect(await exports.RealtimeRpc.kick(USERS.ada, 'banned')).toBe(true);
    await ada.client.notice('banned');
    expect((await ada.client.waitClosed()).code).toBe(CLOSE.banned);
    await bob.client.barrier();
    expect(bob.client.closed).toBeNull();
  });

  it('RealtimeRpc.worldUpdate tells players which booths changed', async () => {
    await shard('w-183');
    const { client } = await placed('w-183', 0, 0);
    await tick('w-183');
    expect(await exports.RealtimeRpc.worldUpdate([BOOTH.id, 'not-a-uuid'])).toBe(1);
    expect((await client.notice('world_update')).data.boothIds).toEqual([BOOTH.id]);
  });
});
