import { FLAG_MINUTES_MAX, type FlagKey, type FlagUpdate } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminErrorText, fetchFlags, setFlag } from './admin-api.ts';
import { when } from './admin-format.ts';

const ROW = 'grid gap-2 rounded-2xl bg-ink-2 p-5';

const MINUTE_FLAGS = {
  MIN_ACCOUNT_AGE_MINUTES: 'Accounts younger than this many minutes can’t submit booths.',
  NEW_ACCOUNT_CHAT_MINUTES: 'Accounts younger than this many minutes can’t chat (0 = no limit).',
} as const;

function MinutesFlag(props: {
  flag: keyof typeof MINUTE_FLAGS;
  value: number;
  isBusy: boolean;
  onSave: (update: FlagUpdate) => void;
}) {
  const [text, setText] = useState(String(props.value));
  const minutes = Number(text);
  const isValid = Number.isInteger(minutes) && minutes >= 0 && minutes <= FLAG_MINUTES_MAX;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        max={FLAG_MINUTES_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={props.flag}
        className="w-28 rounded-lg bg-ink p-2"
      />
      <button
        type="button"
        disabled={!isValid || props.isBusy || minutes === props.value}
        onClick={() => props.onSave({ key: props.flag, value: minutes })}
        className="rounded-xl bg-accent px-4 py-2 font-bold text-ink disabled:opacity-60"
      >
        Save
      </button>
    </div>
  );
}

/** Feature flags (prompt 09 §7). The Worker re-reads them within 30 s of a change. */
export function FlagsPanel() {
  const query = useQuery({ queryKey: ['admin', 'flags'], queryFn: fetchFlags });
  // The edit being saved: shown at once, dropped once the saved value is back (or on failure).
  const [saving, setSaving] = useState<FlagUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isBusy = saving !== null;

  if (query.isPending) return <p className="text-muted">Loading flags…</p>;
  if (query.isError) return <p role="alert">{adminErrorText(query.error)}</p>;
  const { flags, updated } = query.data;
  const isOpen = saving?.key === 'SUBMISSIONS_OPEN' ? saving.value : flags.SUBMISSIONS_OPEN;

  const save = async (update: FlagUpdate) => {
    setSaving(update);
    setError(null);
    try {
      await setFlag(update);
      await query.refetch();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setSaving(null);
    }
  };
  const changed = (key: FlagKey) => {
    const row = updated.find((u) => u.key === key);
    return row ? (
      <p className="text-muted text-xs">
        Changed {when(row.updatedAt)}
        {row.updatedBy ? ` by @${row.updatedBy}` : ''}
      </p>
    ) : null;
  };

  return (
    <section aria-labelledby="flags-title" className="grid gap-4">
      <h2 id="flags-title" className="font-bold text-xl">
        Feature flags
      </h2>
      <p className="text-muted text-sm">Changes reach every server within 30 seconds.</p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <div className={ROW}>
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={isOpen}
            disabled={isBusy}
            onChange={(e) => void save({ key: 'SUBMISSIONS_OPEN', value: e.target.checked })}
            data-testid="flag-SUBMISSIONS_OPEN"
          />
          SUBMISSIONS_OPEN
        </label>
        <p className="text-sm">
          Off shows makers “Submissions are paused” and refuses new submits and edits.
        </p>
        {changed('SUBMISSIONS_OPEN')}
      </div>
      {(Object.keys(MINUTE_FLAGS) as (keyof typeof MINUTE_FLAGS)[]).map((key) => (
        <div key={key} className={ROW}>
          <p className="font-semibold">{key}</p>
          <p className="text-sm">{MINUTE_FLAGS[key]}</p>
          <MinutesFlag
            key={flags[key]}
            flag={key}
            value={flags[key]}
            isBusy={isBusy}
            onSave={(update) => void save(update)}
          />
          {changed(key)}
        </div>
      ))}
      <div className={ROW}>
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" checked={false} disabled readOnly />
          GUEST_CHAT
        </label>
        <p className="text-sm">Guests can’t chat in v1. The flag is wired for later.</p>
      </div>
    </section>
  );
}
