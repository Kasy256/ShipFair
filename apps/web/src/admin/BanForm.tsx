import { BAN_REASON_MAX_CHARS, BanRequest } from '@shipfair/shared';
import { type FormEvent, useState } from 'react';
import { adminErrorText, banUser } from './admin-api.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Permanent', days: null },
] as const;

interface BanFormProps {
  userId: string;
  handle: string;
  defaultReason?: string;
  onDone: () => void;
}

/** Bans take effect at once: the Worker kicks the user's sockets after saving the ban. */
export function BanForm({ userId, handle, defaultReason = '', onDone }: BanFormProps) {
  const [reason, setReason] = useState(defaultReason);
  const [days, setDays] = useState<number | null>(7);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const request = BanRequest.safeParse({
      userId,
      reason,
      ...(days === null ? {} : { until: new Date(Date.now() + days * DAY_MS).toISOString() }),
    });
    if (!request.success) return setError('Give a reason of at least 3 characters');
    setIsBusy(true);
    setError(null);
    try {
      await banUser(request.data);
      onDone();
    } catch (err) {
      setError(adminErrorText(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl bg-ink p-3" data-testid="ban-form">
      <p className="font-semibold">Ban @{handle}</p>
      <label className="grid gap-1 text-sm">
        Reason (kept in the log)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={BAN_REASON_MAX_CHARS}
          className="rounded-lg bg-ink-2 p-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        For
        <select
          value={days ?? 'forever'}
          onChange={(e) => setDays(e.target.value === 'forever' ? null : Number(e.target.value))}
          className="rounded-lg bg-ink-2 p-2"
        >
          {DURATIONS.map((d) => (
            <option key={d.label} value={d.days ?? 'forever'}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="justify-self-start rounded-xl bg-red-300 px-4 py-2 font-bold text-ink disabled:opacity-60"
      >
        {isBusy ? 'Banning…' : `Ban @${handle}`}
      </button>
    </form>
  );
}
