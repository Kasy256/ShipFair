import { REPORT_NOTE_MAX_CHARS, type ReportReason } from '@shipfair/shared';
import { type FormEvent, useId, useState } from 'react';
import { socialErrorText } from '../errors.ts';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or self-promo flooding' },
  { value: 'scam', label: 'Scam or malware' },
  { value: 'nsfw', label: 'NSFW content' },
  { value: 'hate', label: 'Hate or harassment' },
  { value: 'other', label: 'Something else' },
];

interface ReportFormProps {
  /** What is reported, for the heading: "this booth", "this entry", "@ada". */
  what: string;
  /** Extra line under the heading, e.g. how many chat lines are attached. */
  detail?: string;
  submit: (reason: ReportReason, note: string) => Promise<void>;
  onClose: () => void;
}

/** A reason picker and an optional note (TRUST_AND_SAFETY.md). Reports go to the staff inbox. */
export function ReportForm({ what, detail, submit, onClose }: ReportFormProps) {
  const id = useId();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [note, setNote] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await submit(reason, note.trim());
      setIsSent(true);
    } catch (failure) {
      setError(socialErrorText(failure));
    } finally {
      setIsBusy(false);
    }
  };

  if (isSent) {
    return (
      <div className="mt-3 rounded-xl bg-ink p-3 text-sm" role="status" data-testid="report-sent">
        <p>Thanks. A moderator will take a look.</p>
        <button type="button" onClick={onClose} className="mt-2 font-semibold text-accent">
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="mt-3 grid gap-2 rounded-xl bg-ink p-3 text-sm"
      aria-labelledby={`${id}-title`}
      data-testid="report-form"
    >
      <p id={`${id}-title`} className="font-semibold">
        Report {what}
      </p>
      {detail && <p className="text-muted">{detail}</p>}
      <label className="grid gap-1">
        <span className="text-muted">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="rounded-lg border border-paper/15 bg-ink-2 px-2 py-1.5"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-muted">Note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={REPORT_NOTE_MAX_CHARS}
          rows={2}
          className="resize-none rounded-lg border border-paper/15 bg-transparent px-2 py-1.5"
        />
      </label>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isBusy}
          className="rounded-lg bg-accent px-3 py-1.5 font-bold text-ink disabled:opacity-60"
        >
          Send report
        </button>
        <button type="button" onClick={onClose} className="rounded-lg bg-ink-3 px-3 py-1.5">
          Cancel
        </button>
      </div>
    </form>
  );
}
