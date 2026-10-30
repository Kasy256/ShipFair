import { Link } from 'react-router';
import { StatusChip } from '../booths/StatusChip.tsx';

interface SubmitDoneProps {
  isRevision: boolean;
  /** True when the link check flagged the URL (the booth is queued anyway). */
  hasUrlWarning: boolean;
}

export function SubmitDone({ isRevision, hasUrlWarning }: SubmitDoneProps) {
  return (
    <section className="mt-8 rounded-2xl bg-ink-2 p-6" aria-labelledby="submit-done">
      <StatusChip status="pending" />
      <h2 id="submit-done" className="mt-3 font-bold text-2xl" data-testid="submit-done">
        {isRevision ? 'Changes sent for review' : 'Submitted for review'}
      </h2>
      <p className="mt-2 text-muted">
        {isRevision
          ? 'Your booth stays as it is until the changes are approved.'
          : 'A person will look at it soon. You can follow it on your profile.'}
      </p>
      {hasUrlWarning && (
        <p className="mt-2 text-amber-300">
          We couldn't reach your link, so the reviewer may ask you to fix it.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/me" className="rounded-xl bg-accent px-5 py-2.5 font-bold text-ink">
          See my booths
        </Link>
        <Link to="/" className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold">
          Back to the city
        </Link>
      </div>
    </section>
  );
}
