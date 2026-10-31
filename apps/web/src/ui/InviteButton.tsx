import { inviteUrl } from '../lib/realtime.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';

/** Copies this address with `?with=<shard>`, so a friend lands in the same shard. */
export function InviteButton({ className }: { className: string }) {
  const shard = useWorldStore((s) => (s.netStatus === 'online' ? s.shard : null));
  const showToast = useUiStore((s) => s.showToast);
  if (!shard) return null;
  const copy = async () => {
    const url = inviteUrl(window.location.href, shard);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied. Friends who open it join you here.');
    } catch (error) {
      console.warn('Clipboard unavailable', error);
      showToast(`Copy this link to invite a friend: ${url}`);
    }
  };
  return (
    <button type="button" className={className} data-testid="invite-friend" onClick={copy}>
      Invite a friend here
    </button>
  );
}
