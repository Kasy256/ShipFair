import { AvatarStyleV2, randomAvatarStyle, rng } from '@shipfair/shared';

interface StyleControlsProps {
  style: AvatarStyleV2;
  onChange: (style: AvatarStyleV2) => void;
}

type Slot = 'hair' | 'facial' | 'headwear' | 'top' | 'bottom' | 'shoes' | 'accessory';
const SLOTS: readonly Slot[] = [
  'hair',
  'facial',
  'headwear',
  'top',
  'bottom',
  'shoes',
  'accessory',
];
const shape = AvatarStyleV2.shape;
const ITEMS: Readonly<Record<Slot, readonly string[]>> = {
  hair: shape.hair.shape.item.options,
  facial: shape.facial.shape.item.options,
  headwear: shape.headwear.shape.item.options,
  top: shape.top.shape.item.options,
  bottom: shape.bottom.shape.item.options,
  shoes: shape.shoes.shape.item.options,
  accessory: shape.accessory.shape.item.options,
};
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const SKIN = range(12);
const COLORS = range(16);

const select = 'rounded bg-ink px-1 py-0.5 ring-1 ring-white/20';

/** Body, items and tints for the dev character. Every change is validated with the v2 schema. */
export function StyleControls({ style, onChange }: StyleControlsProps) {
  const apply = (next: unknown) => {
    const parsed = AvatarStyleV2.safeParse(next);
    if (parsed.success) onChange(parsed.data);
  };
  return (
    <fieldset className="mt-2 grid grid-cols-2 gap-1 text-xs">
      <legend className="sr-only">Avatar style</legend>
      <label className="flex justify-between gap-1">
        body
        <select
          className={select}
          value={style.body}
          onChange={(e) => apply({ ...style, body: e.target.value })}
        >
          {shape.body.options.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="flex justify-between gap-1">
        skin
        <select
          className={select}
          value={style.skin}
          onChange={(e) => apply({ ...style, skin: Number(e.target.value) })}
        >
          {SKIN.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </label>
      {SLOTS.map((slot) => (
        <div key={slot} className="col-span-2 flex items-center justify-between gap-1">
          <label className="flex grow justify-between gap-1">
            {slot}
            <select
              className={select}
              value={style[slot].item}
              onChange={(e) =>
                apply({ ...style, [slot]: { ...style[slot], item: e.target.value } })
              }
            >
              {ITEMS[slot].map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="flex gap-1">
            <span className="sr-only">{slot} colour</span>
            <select
              className={select}
              value={style[slot].color}
              onChange={(e) =>
                apply({ ...style, [slot]: { ...style[slot], color: Number(e.target.value) } })
              }
            >
              {(slot === 'hair' || slot === 'facial' ? range(12) : COLORS).map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() => apply({ ...randomAvatarStyle(rng(Date.now() >>> 0)), body: style.body })}
        className="col-span-2 mt-1 rounded bg-accent px-2 py-1 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-paper"
      >
        Random outfit
      </button>
    </fieldset>
  );
}
