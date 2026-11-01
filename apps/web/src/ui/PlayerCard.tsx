import type { ReportReason } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { makerLinks } from '../lib/booth-links.ts';
import { fetchMaker, socialClient, submitReport } from '../lib/social-api.ts';
import { useChatStore } from '../state/chat-store.ts';
import { useSessionStore } from '../state/session-store.ts';
import { type SelectedPlayer, useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { Sheet } from './Sheet.tsx';
import { ReportForm } from './social/ReportForm.tsx';

/** The mini profile card for a clicked or tapped player (prompt 12): who, their booths, mute, report. */
export function PlayerCard() {
  const player = useUiStore((s) => s.selectedPlayer);
  const selectPlayer = useUiStore((s) => s.selectPlayer);
  const close = () => selectPlayer(null);
  return (
    <Sheet
      isOpen={player !== null}
      onClose={close}
      labelledBy="player-card-title"
      variant="side"
      testId="player-card"
    >
      {player && <PlayerDetails key={player.id} player={player} onClose={close} />}
    </Sheet>
  );
}

const action = 'rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm hover:bg-ink';

function PlayerDetails({ player, onClose }: { player: SelectedPlayer; onClose: () => void }) {
  const myId = useSessionStore((s) => s.userId);
  const userId = player.userId;
  const isMuted = useSessionStore((s) => (userId ? s.mutedUserIds.includes(userId) : false));
  const setMuted = useSessionStore((s) => s.setMuted);
  const openBooth = useUiStore((s) => s.openBooth);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const showToast = useUiStore((s) => s.showToast);
  const snapshot = useWorldStore((s) => s.snapshot);
  const lineCount = useChatStore((s) => (userId ? (s.byUser.get(userId)?.length ?? 0) : 0));
  const location = useLocation();
  const [isReporting, setIsReporting] = useState(false);
  const profile = useQuery({
    queryKey: ['player-profile', userId],
    queryFn: async () => (userId ? fetchMaker(await socialClient(), userId) : null),
    enabled: userId !== null,
    staleTime: 60_000,
  });
  const booths = userId ? (snapshot?.booths.filter((b) => b.ownerId === userId) ?? []) : [];
  const links = profile.data ? makerLinks(profile.data.links) : [];
  const isMe = userId !== null && userId === myId;

  const toggleMute = () => {
    if (!userId) return;
    setMuted(userId, !isMuted);
    showToast(isMuted ? `You can hear ${player.name} again.` : `${player.name} is muted for you.`);
  };
  const report = async (reason: ReportReason, note: string) => {
    if (!userId || !myId) return;
    const context = useChatStore.getState().contextFor(userId);
    await submitReport(await socialClient(), myId, {
      targetType: 'user',
      targetId: userId,
      reason,
      ...(note ? { note } : {}),
      context,
    });
  };

  return (
    <article>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="player-card-title" className="font-bold text-2xl leading-tight">
            {player.name}
          </h2>
          {profile.data && (
            <p className="text-muted" data-testid="player-handle">
              @{profile.data.handle}
            </p>
          )}
          {player.isGuest && (
            <p className="mt-1 text-muted text-sm">
              A guest visitor. Guests can walk around and emote, but can't chat.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-lg px-2 py-1 text-2xl leading-none text-muted hover:text-paper"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Close player card</span>
        </button>
      </div>

      {links.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 text-sm" aria-label="Links">
          {links.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}

      {booths.length > 0 && (
        <section aria-labelledby="player-booths" className="mt-4">
          <h3 id="player-booths" className="text-muted text-xs uppercase tracking-wider">
            Their booths
          </h3>
          <ul className="mt-1 grid gap-1">
            {booths.map((booth) => (
              <li key={booth.id}>
                <button
                  type="button"
                  onClick={() => openBooth(booth.id)}
                  className="font-semibold text-accent hover:underline"
                >
                  {booth.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {userId && !isMe && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={isMuted}
            className={action}
            data-testid="player-mute"
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          {myId ? (
            <button
              type="button"
              onClick={() => setIsReporting((v) => !v)}
              aria-expanded={isReporting}
              className={action}
              data-testid="player-report"
            >
              Report
            </button>
          ) : (
            <button type="button" onClick={() => openSignIn(location.pathname)} className={action}>
              Sign in to report
            </button>
          )}
        </div>
      )}
      {isReporting && (
        <ReportForm
          what={profile.data ? `@${profile.data.handle}` : player.name}
          detail={
            lineCount > 0
              ? `Their last ${lineCount} chat ${lineCount === 1 ? 'line' : 'lines'} you saw will be attached.`
              : 'You have no chat lines from them to attach.'
          }
          submit={report}
          onClose={() => setIsReporting(false)}
        />
      )}
    </article>
  );
}
