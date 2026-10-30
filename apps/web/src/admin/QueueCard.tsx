import type { QueueItem } from '@shipfair/shared';
import { Link } from 'react-router';
import { StatusChip } from '../ui/booths/StatusChip.tsx';
import { AdminImage } from './AdminImage.tsx';
import { ageText, when } from './admin-format.ts';

const label = 'font-semibold text-muted text-xs uppercase tracking-wide';

function Flags({ item }: { item: QueueItem }) {
  if (item.score >= 1000) return <p className="text-amber-300 text-sm">Never pre-screened</p>;
  return (
    <p className="text-sm">
      <span className={item.score === 0 ? 'text-emerald-300' : 'text-amber-300'}>
        Score {item.score}
      </span>
      {item.flags.length > 0 && <span className="text-muted"> · {item.flags.join(', ')}</span>}
    </p>
  );
}

/** One booth (or edit) to review: content, link, maker and pre-screen, all on one card. */
export function QueueCard({ item }: { item: QueueItem }) {
  const isRedirected = item.finalUrl !== null && item.finalUrl !== item.url;
  return (
    <article
      className="rounded-2xl bg-ink-2 p-5"
      data-testid="queue-card"
      data-booth-id={item.boothId}
      data-kind={item.kind}
      aria-labelledby="queue-card-name"
    >
      <div className="flex flex-wrap items-start gap-4">
        <AdminImage
          mediaKey={item.logoKey}
          alt={`${item.name} logo`}
          className="size-24 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          {item.kind === 'revision' && (
            <p className="mb-1 inline-block rounded-full bg-sky-300 px-2.5 py-0.5 font-bold text-ink text-xs">
              Edit to a live booth
            </p>
          )}
          <h2 id="queue-card-name" className="font-bold text-2xl">
            {item.name}
          </h2>
          <p className="mt-1">{item.tagline}</p>
          {item.live && item.live.tagline !== item.tagline && (
            <p className="mt-1 text-muted text-sm">Live now: {item.live.tagline}</p>
          )}
          <Flags item={item} />
        </div>
      </div>

      <div className="mt-4 grid gap-1">
        <p className={label}>Link</p>
        <p className="break-all">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {item.url}
          </a>
        </p>
        {isRedirected && item.finalUrl && (
          <p className="break-all text-sm">
            Ends up at <span className="font-semibold">{item.finalUrl}</span>
          </p>
        )}
        {item.finalUrl === null && item.score < 1000 && (
          <p className="text-amber-300 text-sm">The pre-screen couldn't reach this link.</p>
        )}
        {item.live && item.live.url !== item.url && (
          <p className="break-all text-muted text-sm">Live link: {item.live.url}</p>
        )}
      </div>

      {item.description && (
        <div className="mt-4">
          <p className={label}>Description</p>
          <p className="whitespace-pre-line">{item.description}</p>
        </div>
      )}

      {item.media.length > 0 && (
        <ul className="mt-4 flex gap-2 overflow-x-auto" aria-label="Screenshots">
          {item.media.map((m, i) => (
            <li key={m.key} className="shrink-0">
              <AdminImage
                mediaKey={m.key}
                alt={`Screenshot ${i + 1}`}
                className="h-36 w-64 rounded-lg"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-1 text-sm">
        <p className={label}>Maker</p>
        <p>
          <Link to={`/admin?tab=users&user=${item.maker.id}`} className="font-semibold text-accent">
            @{item.maker.handle}
          </Link>{' '}
          ({item.maker.displayName}) · account {ageText(item.maker.createdAt)} old · submitted{' '}
          {when(item.submittedAt)}
        </p>
        {item.maker.otherBooths.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {item.maker.otherBooths.map((b) => (
              <li key={b.id} className="flex items-center gap-1">
                {b.name} <StatusChip status={b.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No other booths.</p>
        )}
      </div>
    </article>
  );
}
