import type { CatalogItem } from '@shipfair/shared';
import { PillGroup } from './PillGroup.tsx';

export interface GridOption {
  id: string;
  name: string;
  thumb: string | null;
  /** Why it can't be chosen right now (locked, doesn't fit), or null. */
  disabledReason: string | null;
}

/** Catalog items as grid options; `none` first when the slot can be empty. */
export function gridOptions(
  items: readonly CatalogItem[],
  opts: { allowNone?: boolean; disabledReason?: (item: CatalogItem) => string | null } = {},
): GridOption[] {
  const none: GridOption[] = opts.allowNone
    ? [{ id: 'none', name: 'None', thumb: null, disabledReason: null }]
    : [];
  return [
    ...none,
    ...items.map((item) => ({
      id: item.id,
      name: item.name,
      thumb: item.thumb,
      disabledReason: opts.disabledReason?.(item) ?? null,
    })),
  ];
}

export interface ItemGridProps {
  label: string;
  name: string;
  options: readonly GridOption[];
  value: string;
  onChange: (id: string) => void;
  /** 'pills' for options without thumbnails (body frames, prints). Default 'tiles'. */
  variant?: 'tiles' | 'pills';
}

/** Thumbnails (pre-rendered by 04c) as native radios, so the grid works with arrow keys. */
export function ItemGrid({
  label,
  name,
  options,
  value,
  onChange,
  variant = 'tiles',
}: ItemGridProps) {
  if (variant === 'pills')
    return (
      <PillGroup label={label} name={name} options={options} value={value} onChange={onChange} />
    );
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      {options.length === 0 && <p className="text-muted text-sm">Nothing matches these filters.</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {options.map((option) => {
          const isDisabled = option.disabledReason !== null;
          return (
            <label
              key={option.id}
              title={option.disabledReason ?? option.name}
              className={`relative ${isDisabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
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
              <span className="flex flex-col items-center gap-1 rounded-xl bg-ink-3 p-1.5 text-center text-xs ring-2 ring-transparent peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                {option.thumb ? (
                  <img
                    src={option.thumb}
                    alt=""
                    loading="lazy"
                    width={256}
                    height={256}
                    className="aspect-square w-full rounded-lg bg-ink"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid aspect-square w-full place-items-center rounded-lg bg-ink text-muted"
                  >
                    {option.id === 'none' ? '∅' : option.name.slice(0, 2)}
                  </span>
                )}
                <span className="leading-tight">{option.name}</span>
                {isDisabled && <span className="sr-only">({option.disabledReason})</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
