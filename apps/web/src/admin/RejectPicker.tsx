import {
  REJECT_NOTE_MAX_CHARS,
  REJECT_REASON_LABELS,
  RejectReason,
  RejectRequest,
} from '@shipfair/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Sheet } from '../ui/Sheet.tsx';

const REASONS = RejectReason.options;

interface RejectPickerProps {
  boothName: string | null;
  isBusy: boolean;
  error: string | null;
  onCancel: () => void;
  onReject: (request: RejectRequest) => void;
}

/**
 * Reasons from TRUST_AND_SAFETY.md "Rejection". Keys: 1–6 pick a reason, Enter rejects, Esc
 * cancels. "Other" needs a note; any note is shown to the maker after the reason.
 */
export function RejectPicker({ boothName, isBusy, error, onCancel, onReject }: RejectPickerProps) {
  const [reason, setReason] = useState<RejectReason>('broken_link');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = RejectRequest.safeParse({ reason, ...(note.trim() ? { note } : {}) });
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? 'Check the reason');
    setProblem(null);
    onReject(parsed.data);
  };

  const pickByNumber = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    const picked = REASONS[Number(e.key) - 1];
    if (picked) {
      e.preventDefault();
      setReason(picked);
    }
  };

  return (
    <Sheet
      isOpen={boothName !== null}
      onClose={onCancel}
      labelledBy="reject-title"
      variant="center"
      testId="reject-picker"
    >
      <form onSubmit={submit} onKeyDown={pickByNumber} className="grid gap-4">
        <h2 id="reject-title" className="font-bold text-xl">
          Reject {boothName}
        </h2>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-muted text-sm">Reason (press 1–6)</legend>
          {REASONS.map((r, i) => (
            <label key={r} className="flex items-center gap-3 rounded-lg bg-ink px-3 py-2">
              <input
                type="radio"
                name="reject-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                // biome-ignore lint/a11y/noAutofocus: the picker opens from a keyboard shortcut
                autoFocus={i === 0}
              />
              <span className="font-mono text-muted text-sm">{i + 1}</span>
              {REJECT_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1">
          <span className="text-sm">
            Note for the maker {reason === 'other' ? '(required)' : '(optional)'}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={REJECT_NOTE_MAX_CHARS}
            rows={3}
            className="rounded-lg bg-ink p-2"
            data-testid="reject-note"
          />
        </label>
        {(problem ?? error) && (
          <p role="alert" className="text-red-300 text-sm">
            {problem ?? error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-xl bg-red-300 px-4 py-2.5 font-bold text-ink disabled:opacity-60"
            data-testid="reject-confirm"
          >
            {isBusy ? 'Rejecting…' : 'Reject booth'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-xl bg-ink-3 px-4 py-2.5">
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
