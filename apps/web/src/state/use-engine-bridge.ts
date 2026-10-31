import { useEffect } from 'react';
import { track } from '../lib/analytics.ts';
import { netNoticeText } from '../ui/errors.ts';
import { engineBus } from './engine-bus.ts';
import { useUiStore } from './ui-store.ts';
import { useWorldStore } from './world-store.ts';

/**
 * Copies engine events into the stores (ARCHITECTURE.md §3: the engine writes to Zustand only
 * through the bus). Payload objects are reused by the engine, so values are copied out.
 */
export function useEngineBridge(): void {
  useEffect(() => {
    const world = useWorldStore.getState;
    const ui = useUiStore.getState;
    const offs = [
      engineBus.on('zone:entered', ({ districtId }) => world().setDistrict(districtId)),
      engineBus.on('booth:focus', ({ boothId }) => world().setFocusedBooth(boothId)),
      engineBus.on('booth:open', ({ boothId }) => {
        ui().openBooth(boothId);
        track({ name: 'booth_open', props: { boothId, source: 'walk' } });
      }),
      engineBus.on('ui:open-submit', () => ui().setClaimOpen(true)),
      engineBus.on('net:status', ({ status, shard }) => world().setNet(status, shard)),
      engineBus.on('net:population', ({ nearby, total }) => world().setPopulation(nearby, total)),
      engineBus.on('net:notice', ({ code, until }) => {
        if (code === 'update_required') world().setUpdateRequired();
        else ui().showToast(netNoticeText(code, until));
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
}
