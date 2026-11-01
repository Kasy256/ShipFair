import { engineBus } from '../../state/engine-bus.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { useWorldStore } from '../../state/world-store.ts';

/**
 * "Maker is here" (prompt 12): the booth's owner is among the players the shard shows you
 * (`isMakerOf` in their summary). "Walk to maker" teleports you next to them.
 */
export function MakerHere({ boothId }: { boothId: string }) {
  const makerId = useWorldStore((s) => s.makersHere.get(boothId));
  const closeBooth = useUiStore((s) => s.closeBooth);
  if (makerId === undefined) return null;
  const walk = () => {
    engineBus.emit('player:walk-to', { id: makerId });
    closeBooth();
  };
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-500/15 px-3 py-2"
      data-testid="maker-here"
    >
      <span className="flex items-center gap-2 font-semibold text-emerald-200 text-sm">
        <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        Maker is here
      </span>
      <button
        type="button"
        onClick={walk}
        className="rounded-lg bg-emerald-400 px-3 py-1 font-bold text-ink text-sm"
      >
        Walk to maker
      </button>
    </div>
  );
}
