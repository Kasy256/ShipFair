import { STEPS, type StepId } from './booth-form.ts';

interface StepNavProps {
  current: StepId;
  /** Steps already passed can be revisited; later ones open only through "Next". */
  reached: number;
  onGo: (step: StepId) => void;
}

/** The step list: numbered, with the current one marked for screen readers. */
export function StepNav({ current, reached, onGo }: StepNavProps) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Steps">
      {STEPS.map((step, i) => {
        const isCurrent = step.id === current;
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={i > reached}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onGo(step.id)}
              className={`rounded-full px-3 py-1 text-sm ${
                isCurrent ? 'bg-accent font-bold text-ink' : 'bg-ink-3 disabled:opacity-50'
              }`}
            >
              {i + 1}. {step.title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
