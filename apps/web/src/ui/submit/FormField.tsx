import type { ReactNode } from 'react';

export const inputClass =
  'mt-1 w-full rounded-xl bg-ink px-3 py-2 text-paper ring-1 ring-white/15 placeholder:text-muted/60 disabled:opacity-60 aria-[invalid=true]:ring-red-400';

interface FormFieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  /** Shown under the input when there is no error (e.g. the URL check). */
  warning?: string | null | undefined;
  children: ReactNode;
}

/** Label, input and one line of help: the error, else a warning, else the hint. */
export function FormField({ id, label, hint, error, warning, children }: FormFieldProps) {
  const message = error ?? warning ?? hint;
  const tone = error ? 'text-red-300' : warning ? 'text-amber-300' : 'text-muted';
  return (
    <div>
      <label htmlFor={id} className="font-semibold text-sm">
        {label}
      </label>
      {children}
      {message && (
        <p id={`${id}-msg`} className={`mt-1 text-sm ${tone}`} aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
