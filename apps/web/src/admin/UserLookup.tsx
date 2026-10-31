import { ADMIN_SEARCH_MAX_CHARS } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { adminErrorText, searchUsers } from './admin-api.ts';
import { UserDetail } from './UserDetail.tsx';

/** Search by handle; `?user=<id>` opens one account (links from the queue and reports use it). */
export function UserLookup() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('user');
  const [text, setText] = useState('');
  const [q, setQ] = useState<string | null>(null);
  const results = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => searchUsers(q ?? ''),
    enabled: q !== null,
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim().toLowerCase());
  };
  const open = (id: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('user', id);
      return next;
    });

  return (
    <section aria-labelledby="users-title" className="grid gap-4">
      <h2 id="users-title" className="font-bold text-xl">
        Users
      </h2>
      <form onSubmit={search} className="flex gap-2">
        <label className="sr-only" htmlFor="user-search">
          Handle
        </label>
        <input
          id="user-search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={ADMIN_SEARCH_MAX_CHARS}
          placeholder="Handle starts with…"
          className="w-64 rounded-lg bg-ink-2 p-2"
        />
        <button type="submit" className="rounded-xl bg-accent px-4 py-2 font-bold text-ink">
          Search
        </button>
      </form>
      {results.isError && <p role="alert">{adminErrorText(results.error)}</p>}
      {results.data && (
        <ul className="grid gap-1" data-testid="user-results">
          {results.data.items.length === 0 && <li className="text-muted">No handles match.</li>}
          {results.data.items.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => open(u.id)}
                className="font-semibold text-accent"
                aria-current={u.id === selected}
              >
                @{u.handle}
              </button>{' '}
              <span className="text-muted text-sm">
                {u.displayName} · {u.role}
              </span>
            </li>
          ))}
        </ul>
      )}
      {selected && <UserDetail key={selected} userId={selected} />}
    </section>
  );
}
