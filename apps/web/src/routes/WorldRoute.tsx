import type { Engine } from '@shipfair/engine';
import { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics.ts';
import { loadEngineModule } from '../lib/engine-loader.ts';
import { WorldLoadError } from '../lib/world-source.ts';
import { attachPlayerView } from '../state/player-view.ts';
import { selectIsOverlayOpen, useUiStore } from '../state/ui-store.ts';
import { useBoothNotices } from '../state/use-booth-notices.ts';
import { useDeepLinks } from '../state/use-deep-links.ts';
import { useEngineBridge } from '../state/use-engine-bridge.ts';
import { useInputLock } from '../state/use-input-lock.ts';
import { useLocalPlayer } from '../state/use-local-player.ts';
import { useRealtime } from '../state/use-realtime.ts';
import { useWorldQuery } from '../state/use-world-query.ts';
import { useWorldShortcuts } from '../state/use-world-shortcuts.ts';
import { useWorldStore } from '../state/world-store.ts';
import { AvatarSheet } from '../ui/avatar/AvatarSheet.tsx';
import { BoothPanel } from '../ui/BoothPanel.tsx';
import { ClaimSheet } from '../ui/ClaimSheet.tsx';
import { ControlsHelp } from '../ui/ControlsHelp.tsx';
import { DistrictBanner } from '../ui/DistrictBanner.tsx';
import { worldErrorText } from '../ui/errors.ts';
import { Hud } from '../ui/Hud.tsx';
import { LoadingScreen, type LoadStage } from '../ui/LoadingScreen.tsx';
import { MapOverlay } from '../ui/MapOverlay.tsx';
import { Minimap } from '../ui/Minimap.tsx';
import { PromptPill } from '../ui/PromptPill.tsx';
import { Toasts } from '../ui/Toasts.tsx';
import { TouchControls } from '../ui/TouchControls.tsx';
import { UpdateBanner } from '../ui/UpdateBanner.tsx';
import { WorldCanvas } from '../ui/WorldCanvas.tsx';

const DEV_HINT =
  import.meta.env.MODE !== 'production'
    ? 'Local development: run `pnpm db:start` for the seeded city, or open /?debug=fake40 for a fake one.'
    : null;

/**
 * The city: one engine for `/`, `/b/:slug` and `/d/:district` (it stays mounted as those change),
 * with the loading screen, HUD, booth panel and map around it.
 */
export function WorldRoute() {
  // Frozen at first render: in-app navigation must never refetch the world or rebuild the city.
  const [search] = useState(() => window.location.search);
  const world = useWorldQuery(search);
  const [engine, setEngine] = useState<Engine>();
  const [stage, setStage] = useState<LoadStage>('world');
  const [hasEngineFailed, setHasEngineFailed] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const startedAt = useRef(performance.now());
  const setWorld = useWorldStore((s) => s.setWorld);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const isOverlayOpen = useUiStore(selectIsOverlayOpen);

  useEngineBridge();
  useLocalPlayer(engine);
  useDeepLinks(engine, hasEntered);
  useWorldShortcuts(hasEntered);
  useBoothNotices(hasEntered);
  useRealtime(engine, hasEntered, search);
  // Nothing behind the loading screen may move the avatar.
  useInputLock(!hasEntered);

  useEffect(() => {
    // Download the engine while the world is fetched. A failure here resurfaces (and is shown)
    // when WorldCanvas awaits the same import.
    loadEngineModule().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (world.data) setWorld(world.data);
  }, [world.data, setWorld]);

  useEffect(() => (engine ? attachPlayerView(engine) : undefined), [engine]);

  useEffect(() => {
    engine?.setReducedMotion(isReducedMotion);
  }, [engine, isReducedMotion]);

  const boothCount = world.data?.snapshot?.booths.length ?? null;
  const hasTracked = useRef(false);
  useEffect(() => {
    if (!engine || stage !== 'ready' || hasTracked.current) return;
    hasTracked.current = true;
    const loadMs = Math.round(performance.now() - startedAt.current);
    track({
      name: 'world_loaded',
      props: { loadMs, tier: engine.quality, booths: boothCount ?? 0 },
    });
  }, [engine, stage, boothCount]);

  const enter = () => {
    engine?.unlockAudio().catch((error: unknown) => console.warn('Audio unlock failed', error));
    setHasEntered(true);
  };

  const error = hasEngineFailed
    ? worldErrorText('engine')
    : world.error
      ? worldErrorText(world.error instanceof WorldLoadError ? world.error.code : 'network')
      : null;
  const retry = () => {
    if (hasEngineFailed) window.location.reload();
    else void world.refetch();
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink font-sans text-paper">
      <WorldCanvas
        source={world.data}
        onStage={setStage}
        onEngine={setEngine}
        onError={() => setHasEngineFailed(true)}
      />
      {!hasEntered && (
        <LoadingScreen
          stage={stage}
          error={error}
          devHint={world.error ? DEV_HINT : null}
          boothCount={boothCount}
          onRetry={retry}
          onEnter={enter}
        />
      )}
      {hasEntered && engine && (
        <>
          <TouchControls engine={engine} />
          <Hud />
          <UpdateBanner />
          <DistrictBanner />
          {!isOverlayOpen && <PromptPill engine={engine} />}
          {engine.layout && <Minimap layout={engine.layout} />}
          <ControlsHelp />
          <BoothPanel />
          <MapOverlay engine={engine} />
          <ClaimSheet />
          <AvatarSheet />
          {!isOverlayOpen && <Toasts />}
        </>
      )}
    </main>
  );
}
