import { useWorldStore } from '../state/world-store.ts';
import { netNoticeText } from './errors.ts';

/** The shard needs a newer client: a banner with a refresh button (the world keeps working). */
export function UpdateBanner() {
  const isUpdateRequired = useWorldStore((s) => s.isUpdateRequired);
  if (!isUpdateRequired) return null;
  return (
    <div
      role="alert"
      data-testid="update-banner"
      className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink/90 px-4 py-2 text-sm backdrop-blur"
    >
      <span>{netNoticeText('update_required', null)}</span>
      <button
        type="button"
        className="rounded-lg bg-accent px-3 py-1 font-semibold text-ink"
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
    </div>
  );
}
