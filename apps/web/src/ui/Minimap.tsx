import type { CityLayout } from '@shipfair/shared';
import { useEffect, useRef } from 'react';
import { arrowAngle, minimapMatrix } from '../lib/minimap.ts';
import { onPlayerView, playerView } from '../state/player-view.ts';
import { useWorldStore } from '../state/world-store.ts';

/** Canvas size in CSS px at the largest layout (smaller screens scale it down). */
const SIZE_PX = 148;
const PX_PER_M = 1.6;
const DOT_M = 2.2;
/** Redraw every Nth engine frame: smooth enough, and half the canvas work. */
const FRAME_STRIDE = 2;

interface MinimapProps {
  layout: CityLayout;
}

/**
 * The prototype's rotating minimap, fed by the city layout (districts, streets, booth dots)
 * instead of colliders. It draws on the engine's frame callback, so React never re-renders for
 * it, and it allocates nothing per frame.
 */
export function Minimap({ layout }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const districts = useWorldStore((s) => s.districtsById);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE_PX * dpr;
    canvas.height = SIZE_PX * dpr;
    const c = (SIZE_PX * dpr) / 2;
    const matrix = new Float64Array(6);
    const colors = layout.districts.map((d) => districts.get(d.id)?.color ?? '#9aa3c7');
    let frame = 0;

    const draw = () => {
      if (frame++ % FRAME_STRIDE !== 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c - 2 * dpr, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(11,16,32,0.82)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const m = minimapMatrix(playerView, PX_PER_M * dpr, c, c, matrix);
      ctx.setTransform(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 0, m[5] ?? 0);
      const plaza = layout.plaza.rect;
      ctx.fillStyle = 'rgba(245,243,238,0.14)';
      ctx.fillRect(plaza.minX, plaza.minZ, plaza.maxX - plaza.minX, plaza.maxZ - plaza.minZ);
      for (let i = 0; i < layout.districts.length; i++) {
        const d = layout.districts[i];
        if (!d) continue;
        const color = colors[i] ?? '#9aa3c7';
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color;
        ctx.fillRect(
          d.rect.minX,
          d.rect.minZ,
          d.rect.maxX - d.rect.minX,
          d.rect.maxZ - d.rect.minZ,
        );
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#f5f3ee';
        for (const s of d.streets) ctx.fillRect(s.minX, s.minZ, s.maxX - s.minX, s.maxZ - s.minZ);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        for (const lot of d.lots) {
          if (lot.boothId) ctx.fillRect(lot.x - DOT_M / 2, lot.z - DOT_M / 2, DOT_M, DOT_M);
        }
      }
      ctx.restore();
      // The player: an arrow at the centre, turned by its heading relative to the camera.
      ctx.setTransform(dpr, 0, 0, dpr, c, c);
      ctx.rotate(arrowAngle(playerView.yaw, playerView.cameraYaw));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
    };
    draw();
    return onPlayerView(draw);
  }, [layout, districts]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="minimap"
      aria-label="Minimap. Your heading points up; coloured squares are booths."
      role="img"
      // Phones: top right, under the buttons (the touch controls own the bottom corners).
      className="pointer-events-none absolute top-14 right-3 z-10 h-28 w-28 rounded-full sm:top-auto sm:bottom-3 sm:h-[148px] sm:w-[148px]"
    />
  );
}
