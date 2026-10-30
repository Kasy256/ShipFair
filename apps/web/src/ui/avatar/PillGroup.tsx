import type { ItemGridProps } from './ItemGrid.tsx';

/** The same radios as text pills, for options that have no picture. */
export function PillGroup({
  label,
  name,
  options,
  value,
  onChange,
}: Omit<ItemGridProps, 'variant'>) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isDisabled = option.disabledReason !== null;
          return (
            <label
              key={option.id}
              title={option.disabledReason ?? option.name}
              className={isDisabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={value === option.id}
                disabled={isDisabled}
                onChange={() => onChange(option.id)}
                className="peer sr-only"
              />
              <span className="block rounded-xl bg-ink-3 px-4 py-2 font-semibold text-sm ring-2 ring-transparent peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                {option.name}
                {isDisabled && (
                  <span className="ml-1 font-normal text-muted text-xs">
                    ({option.disabledReason})
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
