import { beforeEach, describe, expect, it } from 'vitest';
import { selectPending, usePassportStore } from './passport-store.ts';

const store = usePassportStore.getState;

beforeEach(() => {
  usePassportStore.setState({ owner: null, stamps: new Map(), opened: [], fresh: [], queue: [] });
});

describe('passport store', () => {
  it('stamps a guest once, without queueing a claim', () => {
    expect(store().earn('district:ai-agents', 1)).toBe(true);
    expect(store().earn('district:ai-agents', 2)).toBe(false);
    expect(store().stamps.get('district:ai-agents')).toEqual({ at: 1, isPending: false });
    expect(store().fresh).toEqual(['district:ai-agents']);
    expect(store().queue).toEqual([]);
  });

  it('queues claims for a signed-in user and keeps them pending', () => {
    store().switchTo('user-1');
    store().earn('squad', 5);
    expect(store().takeQueue()).toEqual(['squad']);
    expect(store().queue).toEqual([]);
    expect(selectPending(store())).toEqual(['squad']);
  });

  it('applies an answer: awarded, pending, and dropped', () => {
    store().switchTo('user-1');
    store().earn('district:dev-tools');
    store().earn('booths:1');
    store().earn('first:note');
    store().applyAnswer(['district:dev-tools', 'booths:1', 'first:note'], {
      awarded: ['district:dev-tools'],
      pending: ['booths:1'],
    });
    expect(store().stamps.get('district:dev-tools')?.isPending).toBe(false);
    expect(store().stamps.get('booths:1')?.isPending).toBe(true);
    expect(store().stamps.has('first:note')).toBe(false);
    expect(store().fresh).toEqual(['district:dev-tools', 'booths:1']);
  });

  it('merges server stamps with pending claims', () => {
    store().switchTo('user-1');
    store().earn('squad');
    store().setServerStamps([{ stamp: 'district:weird', createdAt: '2026-11-01T10:00:00+00:00' }]);
    expect([...store().stamps.keys()].sort()).toEqual(['district:weird', 'squad']);
  });

  it('counts distinct opened booths', () => {
    expect(store().markOpened('a')).toBe(1);
    expect(store().markOpened('a')).toBe(1);
    expect(store().markOpened('b')).toBe(2);
  });

  it('switching back to the guest drops the user stamps', () => {
    store().switchTo('user-1');
    store().earn('squad');
    store().switchTo(null);
    expect(store().stamps.has('squad')).toBe(false);
  });
});
