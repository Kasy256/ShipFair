import type { AdminMe } from '@shipfair/shared';
import { Link, useSearchParams } from 'react-router';
import { FlagsPanel } from './FlagsPanel.tsx';
import { ModLog } from './ModLog.tsx';
import { ReportsInbox } from './ReportsInbox.tsx';
import { ReviewQueue } from './ReviewQueue.tsx';
import { UserLookup } from './UserLookup.tsx';

const TABS = [
  { id: 'queue', label: 'Queue', Panel: ReviewQueue },
  { id: 'reports', label: 'Reports', Panel: ReportsInbox },
  { id: 'users', label: 'Users', Panel: UserLookup },
  { id: 'log', label: 'Log', Panel: ModLog },
  { id: 'flags', label: 'Flags', Panel: FlagsPanel },
] as const;

/** `/admin` for staff (lazy chunk; AdminRoute only loads it after the server says "staff"). */
export function AdminApp({ me }: { me: AdminMe }) {
  const [params] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];
  const { Panel } = tab;

  return (
    <main className="min-h-dvh bg-ink px-4 py-8 text-paper" data-testid="admin">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/" className="font-semibold text-accent">
              ← Back to the city
            </Link>
            <h1 className="mt-2 font-bold text-3xl">Admin</h1>
          </div>
          <p className="text-muted text-sm">
            @{me.handle} · {me.role}
          </p>
        </header>
        <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.id}
              to={`/admin?tab=${t.id}`}
              aria-current={t.id === tab.id ? 'page' : undefined}
              className={`rounded-full px-4 py-1.5 font-semibold ${
                t.id === tab.id ? 'bg-accent text-ink' : 'bg-ink-2'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Panel />
      </div>
    </main>
  );
}
