import {
  AvatarStyleV2 as AvatarStyleSchema,
  type AvatarStyleV2,
  HAIR_HEX,
  SKIN_HEX,
} from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { fetchAvatarCatalog, itemsOf } from '../../lib/avatar-catalog.ts';
import { AvatarPreviewCanvas } from './AvatarPreviewCanvas.tsx';
import { HairPanel } from './HairPanel.tsx';
import { type GridOption, ItemGrid } from './ItemGrid.tsx';
import { PrintPanel } from './PrintPanel.tsx';
import { SlotPanel } from './SlotPanel.tsx';
import { Swatches } from './Swatches.tsx';
import {
  type FollowHair,
  followsHair,
  headwearFits,
  randomise,
  setBody,
  setColor,
  setSkin,
} from './style-edits.ts';

const TABS = [
  ['body', 'Body'],
  ['skin', 'Skin'],
  ['hair', 'Hair'],
  ['facial', 'Facial hair'],
  ['headwear', 'Headwear'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['shoes', 'Shoes'],
  ['extras', 'Extras'],
  ['print', 'Print'],
] as const;
type Tab = (typeof TABS)[number][0];

/** Body ids end in `_f` / `_m` (art/config/characters.json); the rest of the id isn't shown. */
const bodyName = (id: string) =>
  id.endsWith('_f') ? 'Narrower frame' : id.endsWith('_m') ? 'Broader frame' : id;
const BODIES: GridOption[] = AvatarStyleSchema.shape.body.options.map((id) => ({
  id,
  name: bodyName(id),
  thumb: null,
  disabledReason: null,
}));

interface AvatarEditorProps {
  value: AvatarStyleV2;
  onChange: (style: AvatarStyleV2) => void;
}

/**
 * The avatar editor (prompt 07): tabs for every slot, options from the generated asset catalog
 * and palettes, a live LOD0 preview, and "Randomise" for a coherent look. Every change is a
 * schema-valid `AvatarStyle` v2.
 */
export function AvatarEditor({ value, onChange }: AvatarEditorProps) {
  const [tab, setTab] = useState<Tab>('body');
  const [follow, setFollow] = useState<FollowHair>(() => followsHair(value));
  const catalog = useQuery({
    queryKey: ['avatar-catalog'],
    queryFn: () => fetchAvatarCatalog(),
    staleTime: Infinity,
  });
  const items = catalog.data ?? [];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = TABS.findIndex(([id]) => id === tab);
    const next = TABS[(i + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next[0]);
    document.getElementById(`avatar-tab-${next[0]}`)?.focus();
  };

  const random = () => {
    const style = randomise(Math.floor(Math.random() * 2 ** 31));
    setFollow(followsHair(style));
    onChange(style);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="mx-auto w-40 sm:sticky sm:top-0 sm:w-full sm:self-start">
        <AvatarPreviewCanvas style={value} />
        <button
          type="button"
          onClick={random}
          className="mt-2 w-full rounded-xl bg-ink-3 px-3 py-2 font-semibold hover:bg-ink"
        >
          Randomise
        </button>
      </div>
      <div className="min-w-0">
        <div
          role="tablist"
          aria-label="Avatar parts"
          onKeyDown={onTabKey}
          className="flex flex-wrap gap-1"
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              id={`avatar-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls="avatar-tabpanel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={`rounded-lg px-2.5 py-1 font-semibold text-sm ${tab === id ? 'bg-accent text-ink' : 'bg-ink-3 hover:bg-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="avatar-tabpanel"
          role="tabpanel"
          aria-labelledby={`avatar-tab-${tab}`}
          className="mt-3"
        >
          {catalog.isPending && <p className="text-muted text-sm">Loading options…</p>}
          {tab === 'body' && (
            <ItemGrid
              label="Body"
              name="body"
              options={BODIES}
              value={value.body}
              onChange={(id) => onChange(setBody(value, id))}
            />
          )}
          {tab === 'skin' && (
            <Swatches
              label="Skin tone"
              name="skin"
              colors={SKIN_HEX}
              value={value.skin}
              onChange={(i) => onChange(setSkin(value, i))}
            />
          )}
          {tab === 'hair' && (
            <HairPanel
              style={value}
              items={itemsOf(items, 'hair')}
              follow={follow}
              onFollow={setFollow}
              onChange={onChange}
            />
          )}
          {tab === 'facial' && (
            <SlotPanel
              slot="facial"
              noun="facial hair"
              style={value}
              items={itemsOf(items, 'facial')}
              allowNone
              onChange={onChange}
              colorControls={
                value.facial.item === 'none' ? null : (
                  <>
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={follow.facial}
                        onChange={(e) => {
                          setFollow({ ...follow, facial: e.target.checked });
                          if (e.target.checked)
                            onChange(setColor(value, 'facial', 'color', value.hair.color));
                        }}
                        className="h-4 w-4 accent-accent"
                      />
                      Match the hair colour
                    </label>
                    {!follow.facial && (
                      <Swatches
                        label="Facial hair colour"
                        name="facial-color"
                        colors={HAIR_HEX}
                        value={value.facial.color}
                        onChange={(c) => onChange(setColor(value, 'facial', 'color', c))}
                      />
                    )}
                  </>
                )
              }
            />
          )}
          {tab === 'headwear' && (
            <SlotPanel
              slot="headwear"
              noun="headwear"
              style={value}
              items={itemsOf(items, 'headwear')}
              allowNone
              disabledReason={(i) =>
                headwearFits(value, i.id) ? null : "Doesn't fit over this hairstyle"
              }
              onChange={onChange}
            />
          )}
          {(tab === 'top' || tab === 'bottom' || tab === 'shoes') && (
            <SlotPanel
              slot={tab}
              noun={tab === 'shoes' ? 'shoes' : tab}
              style={value}
              items={itemsOf(items, tab)}
              allowNone={false}
              onChange={onChange}
            />
          )}
          {tab === 'extras' && (
            <SlotPanel
              slot="accessory"
              noun="accessory"
              style={value}
              items={itemsOf(items, 'accessory')}
              allowNone
              onChange={onChange}
            />
          )}
          {tab === 'print' && (
            <PrintPanel style={value} tops={itemsOf(items, 'top')} onChange={onChange} />
          )}
        </div>
      </div>
    </div>
  );
}
