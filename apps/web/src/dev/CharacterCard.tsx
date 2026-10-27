import type { AssetViewer, CharacterView } from '@shipfair/engine';
import {
  AvatarStyleV2,
  type BuiltCharacter,
  hashString,
  randomAvatarStyle,
  rng,
} from '@shipfair/shared';
import { useEffect, useRef, useState } from 'react';
import { StatsLine } from './StatsLine.tsx';
import { StyleControls } from './StyleControls.tsx';

interface CharacterCardProps {
  viewer: AssetViewer;
  character: BuiltCharacter;
  clips: readonly string[];
}

const STATE_MACHINE = '';

/** A body with any outfit and tints, LOD0 and LOD1 side by side, playing any clip. */
export function CharacterCard({ viewer, character, clips }: CharacterCardProps) {
  const body = character.id.replace(/^body_/, '');
  const [style, setStyle] = useState<AvatarStyleV2>(() => {
    const random = randomAvatarStyle(rng(hashString(character.id)));
    const parsed = AvatarStyleV2.safeParse({ ...random, body });
    return parsed.success ? parsed.data : random;
  });
  const [clip, setClip] = useState(STATE_MACHINE);
  const [error, setError] = useState<string>();
  const [tris, setTris] = useState<[number, number]>([0, 0]);
  /** Bumped when a view finishes building, so the triangle readout refreshes. */
  const [built, setBuilt] = useState(0);
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)] as const;
  const views = useRef<(CharacterView | undefined)[]>([]);
  const first = useRef(style);

  useEffect(() => {
    let isCurrent = true;
    const created: CharacterView[] = [];
    ([0, 1] as const).forEach((lod) => {
      const element = refs[lod].current;
      if (!element) return;
      viewer.addCharacter(element, first.current, lod).then(
        (view) => {
          if (!isCurrent) return view.dispose();
          created.push(view);
          views.current[lod] = view;
          setBuilt((n) => n + 1);
        },
        (e: unknown) => setError(String(e)),
      );
    });
    return () => {
      isCurrent = false;
      for (const v of created) v.dispose();
      views.current = [];
    };
  }, [viewer, refs[0], refs[1]]);

  useEffect(() => {
    if (built === 0) return; // no view yet; each one starts from the first style
    for (const view of views.current) view?.setStyle(style);
    // Item changes rebuild asynchronously; read the merged triangle counts a moment later.
    const timer = setTimeout(
      () => setTris([views.current[0]?.triangles ?? 0, views.current[1]?.triangles ?? 0]),
      500,
    );
    return () => clearTimeout(timer);
  }, [style, built]);

  useEffect(() => {
    for (const view of views.current) view?.playClip(clip === STATE_MACHINE ? null : clip);
  }, [clip]);

  return (
    <article
      data-testid="asset-card"
      data-asset={character.id}
      className="col-span-2 rounded-lg bg-ink/80 p-2 ring-1 ring-white/10"
    >
      <div className="grid grid-cols-2 gap-2">
        <div
          ref={refs[0]}
          className="aspect-[3/4] rounded"
          role="img"
          aria-label={`${character.id} LOD0`}
        />
        <div
          ref={refs[1]}
          className="aspect-[3/4] rounded"
          role="img"
          aria-label={`${character.id} LOD1`}
        />
      </div>
      <h3 className="mt-2 font-semibold text-sm">{character.id}</h3>
      {error && (
        <p role="alert" className="text-red-300 text-xs">
          {error}
        </p>
      )}
      <StatsLine label="LOD0" stats={character.stats} isPlaceholder={character.isPlaceholder} />
      <StatsLine label={`LOD1 (error ${character.lod1.error})`} stats={character.lod1.stats} />
      <p className="text-xs opacity-80">
        Merged avatar now: LOD0 {tris[0].toLocaleString()} tris · LOD1 {tris[1].toLocaleString()}{' '}
        tris
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs">
        Clip
        <select
          value={clip}
          onChange={(e) => setClip(e.target.value)}
          className="rounded bg-ink px-1 py-0.5 ring-1 ring-white/20"
        >
          <option value={STATE_MACHINE}>state machine (idle)</option>
          {clips.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <StyleControls style={style} onChange={setStyle} />
    </article>
  );
}
