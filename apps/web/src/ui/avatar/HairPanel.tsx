import { type AvatarStyleV2, type CatalogItem, HAIR_HEX } from '@shipfair/shared';
import { useState } from 'react';
import { gridOptions, ItemGrid } from './ItemGrid.tsx';
import { Swatches } from './Swatches.tsx';
import { type FollowHair, hairFits, setBrowColor, setHair, setHairColor } from './style-edits.ts';

interface HairPanelProps {
  style: AvatarStyleV2;
  items: readonly CatalogItem[];
  follow: FollowHair;
  onFollow: (follow: FollowHair) => void;
  onChange: (style: AvatarStyleV2) => void;
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Distinct values in catalog order (the art manifest lists textures and lengths in order). */
const distinct = (values: readonly (string | null)[]) =>
  [...new Set(values)].filter((v): v is string => v !== null && v !== 'none');

interface ChipsProps {
  label: string;
  values: readonly string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

function Chips({ label, values, value, onChange }: ChipsProps) {
  const chip = (isOn: boolean) =>
    `rounded-full px-3 py-1 font-semibold text-xs ${isOn ? 'bg-accent text-ink' : 'bg-ink-3 hover:bg-ink'}`;
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="sr-only">{label}</legend>
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={chip(value === null)}
      >
        All
      </button>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? null : v)}
          className={chip(value === v)}
        >
          {title(v)}
        </button>
      ))}
    </fieldset>
  );
}

/** Hairstyles filtered by texture and length, hair colour, and brows (they follow by default). */
export function HairPanel({ style, items, follow, onFollow, onChange }: HairPanelProps) {
  const [texture, setTexture] = useState<string | null>(null);
  const [length, setLength] = useState<string | null>(null);
  const textures = distinct(items.map((i) => i.family));
  const lengths = distinct(items.map((i) => i.length));
  const shown = items.filter(
    (i) => (texture === null || i.family === texture) && (length === null || i.length === length),
  );
  const options = gridOptions(shown, {
    disabledReason: (item) =>
      hairFits(style, item.id)
        ? null
        : `Doesn't fit under the ${style.headwear.item}; remove it first`,
  });

  return (
    <div className="space-y-3">
      {textures.length > 0 && (
        <Chips label="Texture" values={textures} value={texture} onChange={setTexture} />
      )}
      {lengths.length > 0 && (
        <Chips label="Length" values={lengths} value={length} onChange={setLength} />
      )}
      <ItemGrid
        label="Hairstyle"
        name="hair"
        options={options}
        value={style.hair.item}
        onChange={(id) => onChange(setHair(style, id))}
      />
      <Swatches
        label="Hair colour"
        name="hair-color"
        colors={HAIR_HEX}
        value={style.hair.color}
        onChange={(c) => onChange(setHairColor(style, c, follow))}
      />
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={follow.brows}
          onChange={(e) => {
            onFollow({ ...follow, brows: e.target.checked });
            if (e.target.checked) onChange(setBrowColor(style, style.hair.color));
          }}
          className="h-4 w-4 accent-accent"
        />
        Brows match the hair colour
      </label>
      {!follow.brows && (
        <Swatches
          label="Brow colour"
          name="brow-color"
          colors={HAIR_HEX}
          value={style.brows.color}
          onChange={(c) => onChange(setBrowColor(style, c))}
        />
      )}
    </div>
  );
}
