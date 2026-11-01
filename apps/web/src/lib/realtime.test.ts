import { fakeWorld } from '@shipfair/shared/fake-world';
import { describe, expect, it } from 'vitest';
import { boothChangesFor, friendShard, inviteUrl, realtimeHost } from './realtime.ts';

const dev = { configured: undefined, isDev: true, pageHostname: 'localhost' };
const prod = { configured: 'rt.shipfair.xyz', isDev: false, pageHostname: 'shipfair.xyz' };

describe('realtimeHost', () => {
  it('uses VITE_REALTIME_HOST in builds and ignores ?realtime there', () => {
    expect(realtimeHost('', prod)).toBe('rt.shipfair.xyz');
    expect(realtimeHost('?realtime=evil.example:1', prod)).toBe('rt.shipfair.xyz');
    expect(realtimeHost('?realtime=off', prod)).toBe('rt.shipfair.xyz');
  });

  it('defaults to port 1999 on this host in development, with overrides', () => {
    expect(realtimeHost('', dev)).toBe('localhost:1999');
    expect(realtimeHost('?realtime=127.0.0.1:8898', dev)).toBe('127.0.0.1:8898');
    expect(realtimeHost('?realtime=off', dev)).toBeNull();
    expect(realtimeHost('?realtime=a/b?c', dev)).toBe('localhost:1999');
  });

  it('keeps deterministic test pages solo unless they name a server', () => {
    expect(realtimeHost('?test&level=test', dev)).toBeNull();
    expect(realtimeHost('?test&realtime=127.0.0.1:8898', dev)).toBe('127.0.0.1:8898');
  });

  it('stays solo in a build without a host', () => {
    expect(realtimeHost('', { ...prod, configured: undefined })).toBeNull();
  });
});

describe('friend links', () => {
  it('reads ?with= only when it names a shard', () => {
    expect(friendShard('?with=w-2')).toBe('w-2');
    expect(friendShard('?test&with=w-17&quality=low')).toBe('w-17');
    expect(friendShard('?with=coordinator')).toBeNull();
    expect(friendShard('')).toBeNull();
  });

  it('builds the invite link from the current address', () => {
    expect(inviteUrl('https://shipfair.xyz/b/my-app?with=w-1', 'w-3')).toBe(
      'https://shipfair.xyz/b/my-app?with=w-3',
    );
    expect(inviteUrl('https://shipfair.xyz/', 'w-2')).toBe('https://shipfair.xyz/?with=w-2');
  });
});

describe('boothChangesFor', () => {
  it('upserts announced booths that exist and removes the ones that are gone', () => {
    const world = fakeWorld(3);
    const [a] = world.booths;
    if (!a) throw new Error('no booths');
    const gone = '00000000-0000-4000-8000-000000000000';
    expect(boothChangesFor(world, [a.id, gone])).toEqual([
      { type: 'upsert', booth: a },
      { type: 'remove', boothId: gone },
    ]);
  });
});
