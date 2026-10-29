import { APP_NAME, type AvatarStyleV2, type CatalogItem, PRINT_PATTERNS } from '@shipfair/shared';
import { type GridOption, ItemGrid } from './ItemGrid.tsx';
import { setPrint } from './style-edits.ts';

interface PrintPanelProps {
  style: AvatarStyleV2;
  tops: readonly CatalogItem[];
  onChange: (style: AvatarStyleV2) => void;
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A chest print: none, a pattern or the ShipFair logo. "Booth logo" comes later (post-launch). */
export function PrintPanel({ style, tops, onChange }: PrintPanelProps) {
  const top = tops.find((t) => t.id === style.top.item);
  const hasPrintArea = top?.hasPrint ?? false;
  const blocked = hasPrintArea ? null : 'This top has no print area';
  const options: GridOption[] = [
    { id: 'none', name: 'None', thumb: null, disabledReason: null },
    ...PRINT_PATTERNS.map((p) => ({ id: p, name: title(p), thumb: null, disabledReason: blocked })),
    { id: 'shipfair', name: `${APP_NAME} logo`, thumb: null, disabledReason: blocked },
    { id: 'booth', name: 'Booth logo', thumb: null, disabledReason: 'Coming soon' },
  ];
  return (
    <div>
      {!hasPrintArea && (
        <p className="mb-3 text-muted text-sm">
          Prints go on tops with a print area. Pick a different top to add one.
        </p>
      )}
      <ItemGrid
        label="Chest print"
        name="print"
        options={options}
        value={style.top.print}
        onChange={(id) => onChange(setPrint(style, id))}
      />
    </div>
  );
}
