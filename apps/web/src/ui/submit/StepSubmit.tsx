import { Link } from 'react-router';
import { TurnstileWidget } from './TurnstileWidget.tsx';

interface StepSubmitProps {
  isRevision: boolean;
  isRulesAccepted: boolean;
  onRulesChange: (isAccepted: boolean) => void;
  /** Changes after each attempt: Turnstile tokens are single use, so the widget restarts. */
  turnstileKey: number;
  onToken: (token: string | null) => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  failure: string | null;
}

export function StepSubmit(props: StepSubmitProps) {
  const { isRevision, isRulesAccepted, onRulesChange, turnstileKey, onToken } = props;
  return (
    <div className="grid gap-5">
      <p className="text-muted">
        {isRevision
          ? 'Your live booth stays as it is until a person reviews these changes.'
          : 'A person reviews every booth before it appears in the city, usually within a day.'}
      </p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={isRulesAccepted}
          onChange={(e) => onRulesChange(e.target.checked)}
          data-testid="rules-checkbox"
        />
        <span>
          This is a real project I make or work on, and it follows the{' '}
          <Link to="/rules" target="_blank" className="font-semibold text-accent underline">
            rules
          </Link>
          .
        </span>
      </label>
      <TurnstileWidget key={turnstileKey} onToken={onToken} />
      {props.failure && (
        <p role="alert" className="text-red-300" data-testid="submit-error">
          {props.failure}
        </p>
      )}
      <button
        type="submit"
        disabled={!props.canSubmit || props.isSubmitting}
        className="justify-self-start rounded-xl bg-accent px-5 py-2.5 font-bold text-ink disabled:opacity-60"
        data-testid="submit-booth"
      >
        {props.isSubmitting ? 'Submitting…' : isRevision ? 'Submit changes' : 'Submit booth'}
      </button>
    </div>
  );
}
