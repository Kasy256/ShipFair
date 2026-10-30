import { type AvatarStyleV2, type CatalogItem, PALETTE_HEX } from '@shipfair/shared';
import { gridOptions, ItemGrid } from './ItemGrid.tsx';
import { Swatches } from './Swatches.tsx';
import { type ItemSlot, setColor, setItem } from './style-edits.ts';

interface SlotPanelProps {
  slot: ItemSlot;
  /** Lower-case noun for labels: "top", "headwear". */
  noun: string;
  style: AvatarStyleV2;
  items: readonly CatalogItem[];
  allowNone: boolean;
  /** Colours to pick from (the clothing palette unless given). */
  palette?: readonly string[];
  disabledReason?: (item: CatalogItem) => string | null;
  /** Extra controls under the grid (e.g. facial hair's "match hair colour"). */
  colorControls?: React.ReactNode;
  onChange: (style: AvatarStyleV2) => void;
}

const LOCKED = 'Unlocks with a passport stamp';

/** An item grid plus one or two colour pickers, as many as the chosen item has (catalog `colors`). */
export function SlotPanel({
  slot,
  noun,
  style,
  items,
  allowNone,
  palette = PALETTE_HEX,
  disabledReason,
  colorControls,
  onChange,
}: SlotPanelProps) {
  const current = style[slot];
  const item = items.find((i) => i.id === current.item);
  const colors = current.item === 'none' ? 0 : (item?.colors ?? 1);
  const options = gridOptions(items, {
    allowNone,
    disabledReason: (i) => (i.unlock ? LOCKED : (disabledReason?.(i) ?? null)),
  });
  const second = 'color2' in current ? current.color2 : undefined;

  return (
    <div>
      <ItemGrid
        label={`Choose a ${noun}`}
        name={slot}
        options={options}
        value={current.item}
        onChange={(id) => onChange(setItem(style, slot, id))}
      />
      {colorControls}
      {colors >= 1 && !colorControls && (
        <Swatches
          label={
            colors === 2
              ? `Main ${noun} colour`
              : `${noun[0]?.toUpperCase()}${noun.slice(1)} colour`
          }
          name={`${slot}-color`}
          colors={palette}
          value={current.color}
          onChange={(c) => onChange(setColor(style, slot, 'color', c))}
        />
      )}
      {colors === 2 && (
        <Swatches
          label={`Second ${noun} colour`}
          name={`${slot}-color2`}
          colors={palette}
          value={second ?? current.color}
          onChange={(c) => onChange(setColor(style, slot, 'color2', c))}
        />
      )}
    </div>
  );
}
