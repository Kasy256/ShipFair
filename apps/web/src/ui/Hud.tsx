import { APP_NAME } from '@shipfair/shared';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { zoneName } from './districts.ts';

/**
 * Top-left: brand, the current district and the live visitor count (a placeholder until the
 * realtime client lands in prompt 11). Top-right: map and help buttons.
 */
export function Hud() {
  const zone = useWorldStore((s) => zoneName(s.currentDistrictId, s.districtsById));
  const setMapOpen = useUiStore((s) => s.setMapOpen);
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);
  const isHelpOpen = useUiStore((s) => s.isHelpOpen);
  const button =
    'pointer-events-auto rounded-lg bg-ink/75 px-3 py-1.5 font-semibold text-sm backdrop-blur hover:bg-ink';

  return (
    <>
      <header className="pointer-events-none absolute top-3 left-3 z-10 rounded-xl bg-ink/70 px-3 py-2 backdrop-blur">
        <h1 className="font-bold text-accent text-lg leading-none tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 font-semibold text-sm" data-testid="hud-district">
          {zone}
        </p>
        <p className="text-muted text-xs">
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400"
          />
          <span title="Live visitor counts arrive with multiplayer">— online</span>
        </p>
      </header>
      <nav aria-label="World" className="absolute top-3 right-3 z-10 flex gap-2">
        <button type="button" className={button} onClick={() => setMapOpen(true)}>
          Map <kbd className="ml-1 text-muted text-xs">M</kbd>
        </button>
        <button
          type="button"
          className={button}
          aria-expanded={isHelpOpen}
          aria-controls="controls-help"
          onClick={() => setHelpOpen(!isHelpOpen)}
        >
          Help <kbd className="ml-1 text-muted text-xs">?</kbd>
        </button>
      </nav>
    </>
  );
}
