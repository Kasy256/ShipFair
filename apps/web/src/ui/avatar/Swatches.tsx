interface SwatchesProps {
  /** Visible legend, e.g. "Hair colour". Also names the radio group. */
  label: string;
  name: string;
  colors: readonly string[];
  value: number;
  onChange: (index: number) => void;
}

/** A colour picker as native radios: arrow keys move between colours, focus ring included. */
export function Swatches({ label, name, colors, value, onChange }: SwatchesProps) {
  return (
    <fieldset className="mt-3">
      <legend className="font-semibold text-sm">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {colors.map((hex, i) => (
          <label key={hex} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={i}
              checked={value === i}
              onChange={() => onChange(i)}
              className="peer sr-only"
              aria-label={`${label} ${i + 1} of ${colors.length}`}
            />
            <span
              aria-hidden="true"
              // The swatch colour is data, so it is the one inline style here.
              style={{ backgroundColor: hex }}
              className="block h-8 w-8 rounded-full ring-2 ring-white/15 peer-checked:ring-4 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
