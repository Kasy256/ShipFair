import { JUST_LAUNCHED_COUNT } from '@shipfair/shared';
import {
  CanvasTexture,
  type Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { WALL_LOGO_PX, WALL_PICK_RANGE_M, WALL_REDRAW_S, WALL_VIEW_RANGE_M } from '../config.ts';
import { context2d, createCanvas } from './textures.ts';

// The plaza's "Just Launched" screen (prompt 13): the newest approved booths with logo, name and
// "x min ago". The canvas is redrawn only when something changed (new booths, a logo arrived,
// the minute ticked over) AND the screen is being drawn (`onBeforeRender`, so it's in the view
// frustum) AND the player is within range: off-screen it costs nothing per frame.

export interface WallEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Logo URL on the media host, or null (a monogram in the district colour is drawn). */
  readonly logoUrl: string | null;
  readonly approvedMs: number;
  readonly color: string;
}

export type LogoLoader = (url: string, px: number) => Promise<ImageBitmap>;

/** Logos for a 2D canvas: unflipped (the booth texture loader flips for WebGL). */
export const fetchLogo: LogoLoader = async (url, px) => {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`logo ${res.status}`);
  return createImageBitmap(await res.blob(), {
    resizeWidth: px,
    resizeHeight: px,
    resizeQuality: 'medium',
  });
};

const CANVAS_W = 1024;
const CANVAS_H = 512;
const HEADER_PX = 112;
const COLS = 2;
const ROWS = JUST_LAUNCHED_COUNT / COLS;
const ROW_H = (CANVAS_H - HEADER_PX - 12) / ROWS;
const COL_W = CANVAS_W / COLS;
const PAD = 32;
const FONT = '"Segoe UI", Helvetica, Arial, sans-serif';
const MINUTE_MS = 60_000;

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ms: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - ms) / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Which entry a point on the screen (u right, v up, both 0–1) falls on, or -1. */
export function entryIndexAt(u: number, v: number): number {
  const px = u * CANVAS_W;
  const py = (1 - v) * CANVAS_H - HEADER_PX;
  if (u < 0 || u > 1 || py < 0) return -1;
  const row = Math.floor(py / ROW_H);
  const col = Math.floor(px / COL_W);
  if (row >= ROWS || col >= COLS) return -1;
  return col * ROWS + row;
}

export class JustLaunchedWall {
  readonly mesh: Mesh;
  readonly #canvas = createCanvas(CANVAS_W, CANVAS_H);
  readonly #texture = new CanvasTexture(this.#canvas);
  readonly #width: number;
  readonly #height: number;
  readonly #load: LogoLoader | null;
  readonly #now: () => number;
  readonly #logos = new Map<string, ImageBitmap | 'loading' | 'failed'>();
  #entries: readonly WallEntry[] = [];
  #isDirty = true;
  #isInRange = false;
  #sinceRedraw = 0;
  #isDisposed = false;
  /** Times the canvas was redrawn (tests and the perf overlay). */
  draws = 0;

  constructor(
    parent: Group,
    at: { x: number; y: number; z: number; w: number; h: number },
    opts: { load: LogoLoader | null; now?: () => number },
  ) {
    this.#width = at.w;
    this.#height = at.h;
    this.#load = opts.load;
    this.#now = opts.now ?? Date.now;
    this.#texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.#texture });
    this.mesh = new Mesh(new PlaneGeometry(at.w, at.h), material);
    this.mesh.name = 'just-launched';
    this.mesh.position.set(at.x, at.y, at.z);
    this.mesh.onBeforeRender = this.#onBeforeRender;
    parent.add(this.mesh);
    this.#draw();
  }

  get entries(): readonly WallEntry[] {
    return this.#entries;
  }

  /** Newest first; at most JUST_LAUNCHED_COUNT are shown. */
  show(entries: readonly WallEntry[]): void {
    this.#entries = entries.slice(0, JUST_LAUNCHED_COUNT);
    const used = new Set(this.#entries.map((e) => e.logoUrl));
    for (const [url, logo] of this.#logos) {
      if (used.has(url)) continue;
      if (typeof logo === 'object') logo.close();
      this.#logos.delete(url);
    }
    this.#isDirty = true;
    if (this.#isInRange) this.#requestLogos();
  }

  /** Per frame, allocation-free: range check and the once-a-minute "x min ago" refresh. */
  update(dt: number, x: number, z: number): void {
    const dx = x - this.mesh.position.x;
    const dz = z - this.mesh.position.z;
    const isInRange = dx * dx + dz * dz <= WALL_VIEW_RANGE_M * WALL_VIEW_RANGE_M;
    if (isInRange && !this.#isInRange) this.#requestLogos();
    this.#isInRange = isInRange;
    this.#sinceRedraw += dt;
    if (this.#sinceRedraw >= WALL_REDRAW_S) this.#isDirty = true;
  }

  /**
   * The booth slug under a ray (a click or tap), or null. The screen faces +z; only rays from
   * the front within WALL_PICK_RANGE_M hit.
   */
  pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): string | null {
    if (dz >= 0) return null;
    const p = this.mesh.position;
    const t = (p.z - oz) / dz;
    if (t < 0 || t > WALL_PICK_RANGE_M) return null;
    const u = (ox + dx * t - p.x) / this.#width + 0.5;
    const v = (oy + dy * t - p.y) / this.#height + 0.5;
    if (v < 0 || v > 1) return null;
    const i = entryIndexAt(u, v);
    return i >= 0 ? (this.#entries[i]?.slug ?? null) : null;
  }

  dispose(): void {
    this.#isDisposed = true;
    for (const logo of this.#logos.values()) if (typeof logo === 'object') logo.close();
    this.#logos.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
  }

  // Assigned once, so three's per-frame call allocates nothing.
  readonly #onBeforeRender = (): void => {
    if (this.#isDirty && this.#isInRange) this.#draw();
  };

  #requestLogos(): void {
    const load = this.#load;
    if (!load) return;
    for (const entry of this.#entries) {
      const url = entry.logoUrl;
      if (!url || this.#logos.has(url)) continue;
      this.#logos.set(url, 'loading');
      load(url, WALL_LOGO_PX).then(
        (bitmap) => {
          if (this.#isDisposed || this.#logos.get(url) !== 'loading') {
            bitmap.close();
            return;
          }
          this.#logos.set(url, bitmap);
          this.#isDirty = true;
        },
        () => {
          if (this.#logos.get(url) === 'loading') this.#logos.set(url, 'failed');
        },
      );
    }
  }

  #draw(): void {
    this.#isDirty = false;
    this.#sinceRedraw = 0;
    this.draws++;
    const ctx = context2d(this.#canvas);
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    gradient.addColorStop(0, '#120c33');
    gradient.addColorStop(1, '#0b3d47');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 56px ${FONT}`;
    ctx.fillText('JUST LAUNCHED', PAD, 52);
    ctx.fillStyle = '#00e5c7';
    ctx.fillRect(PAD, 90, 200, 7);
    if (this.#entries.length === 0) {
      ctx.fillStyle = '#c9c4ff';
      ctx.font = `700 36px ${FONT}`;
      ctx.fillText('New booths appear here.', PAD, 200);
    }
    const now = this.#now();
    const logoPx = ROW_H - 14;
    this.#entries.forEach((entry, i) => {
      const x = Math.floor(i / ROWS) * COL_W + PAD;
      const y = HEADER_PX + (i % ROWS) * ROW_H + 7;
      const logo = entry.logoUrl ? this.#logos.get(entry.logoUrl) : undefined;
      if (typeof logo === 'object') {
        ctx.drawImage(logo, x, y, logoPx, logoPx);
      } else {
        ctx.fillStyle = entry.color;
        ctx.fillRect(x, y, logoPx, logoPx);
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(logoPx * 0.55)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(entry.name.slice(0, 1).toUpperCase(), x + logoPx / 2, y + logoPx / 2 + 2);
        ctx.textAlign = 'left';
      }
      const textX = x + logoPx + 14;
      const maxW = COL_W - PAD * 1.5 - logoPx - 14;
      ctx.fillStyle = i === 0 ? '#ffd23f' : '#f2f0ff';
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(entry.name, textX, y + logoPx * 0.32, maxW);
      ctx.fillStyle = '#9fe9de';
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText(timeAgo(entry.approvedMs, now), textX, y + logoPx * 0.78, maxW);
    });
    this.#texture.needsUpdate = true;
  }
}
