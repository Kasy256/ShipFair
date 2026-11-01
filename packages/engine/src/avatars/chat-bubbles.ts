import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  type MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import {
  CHAT_BUBBLE_ATLAS_COLUMNS,
  CHAT_BUBBLE_ATLAS_PX,
  CHAT_BUBBLE_ATLAS_ROWS,
  CHAT_BUBBLE_FADE_S,
  CHAT_BUBBLE_HEIGHT_M,
  CHAT_BUBBLE_MAX_LINES,
  CHAT_BUBBLE_MAX_W_PX,
  CHAT_BUBBLE_S,
  NAME_TAG_MAX_SCALE,
  NAME_TAG_NEAR_M,
} from '../config.ts';
import { cellUv, createBillboardMaterial } from '../render/billboard-material.ts';
import { context2d, createCanvas } from '../world/textures.ts';
import { wrapBubbleText } from './bubble-text.ts';

// Speech bubbles above players (prompt 12): each message is drawn once into a cell of one canvas
// atlas (text only, with fillText: never parsed as markup or links) and shown for CHAT_BUBBLE_S
// as a billboarded instance of one quad, so every bubble is one draw call. One bubble per
// speaker: a new message replaces the old one. They are decorative; the chat log in the UI is the
// accessible copy.

const CELL_W = CHAT_BUBBLE_ATLAS_PX / CHAT_BUBBLE_ATLAS_COLUMNS;
const CELL_H = CHAT_BUBBLE_ATLAS_PX / CHAT_BUBBLE_ATLAS_ROWS;
const CELLS = CHAT_BUBBLE_ATLAS_COLUMNS * CHAT_BUBBLE_ATLAS_ROWS;
const ASPECT = CELL_W / CELL_H;
const FONT = '500 19px "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const LINE_PX = 24;
const PAD_X = 12;
const PAD_Y = 8;
const TAIL_PX = 10;

const scratch = new Matrix4();
const pos = new Vector3();
const size = new Vector3();
const noRotation = new Quaternion();
const uv = new Vector2();

interface Bubble {
  /** Who said it: a remote net id, or −1 for the local player. */
  speaker: number;
  cell: number;
  ageS: number;
  text: string;
}

export class ChatBubbles {
  readonly mesh: InstancedMesh;
  readonly #canvas = createCanvas(CHAT_BUBBLE_ATLAS_PX, CHAT_BUBBLE_ATLAS_PX);
  readonly #ctx = context2d(this.#canvas);
  readonly #texture: CanvasTexture;
  readonly #cells: InstancedBufferAttribute;
  readonly #fades: InstancedBufferAttribute;
  readonly #bubbles: Bubble[] = [];
  readonly #free: number[] = [];
  #count = 0;

  constructor() {
    for (let cell = CELLS - 1; cell >= 0; cell--) this.#free.push(cell);
    this.#texture = new CanvasTexture(this.#canvas);
    this.#texture.colorSpace = SRGBColorSpace;
    this.#texture.minFilter = LinearFilter;
    this.#texture.generateMipmaps = false;
    const geometry = new PlaneGeometry(1, 1);
    // The quad's bottom edge sits on the anchor, so bubbles grow upwards.
    geometry.translate(0, 0.5, 0);
    this.#cells = new InstancedBufferAttribute(new Float32Array(CELLS * 2), 2);
    this.#fades = new InstancedBufferAttribute(new Float32Array(CELLS).fill(1), 1);
    this.#cells.setUsage(DynamicDrawUsage);
    this.#fades.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCell', this.#cells);
    geometry.setAttribute('aFade', this.#fades);
    const material = createBillboardMaterial({
      map: this.#texture,
      name: 'chat-bubbles',
      columns: CHAT_BUBBLE_ATLAS_COLUMNS,
      rows: CHAT_BUBBLE_ATLAS_ROWS,
      aspect: ASPECT,
      cacheKey: 'shipfair-chat-bubbles-1',
    });
    this.mesh = new InstancedMesh(geometry, material, CELLS);
    this.mesh.name = 'chat-bubbles';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11; // over name tags
    this.mesh.count = 0;
  }

  /** Estimated GPU bytes of the atlas (RGBA, no mips). */
  get bytes(): number {
    return CHAT_BUBBLE_ATLAS_PX * CHAT_BUBBLE_ATLAS_PX * 4;
  }

  /** Bubbles drawn last frame. */
  get count(): number {
    return this.#count;
  }

  /** Shows `text` above `speaker` (−1: the local player), replacing their previous bubble. */
  say(speaker: number, text: string): void {
    let bubble = this.#bubbles.find((b) => b.speaker === speaker);
    if (!bubble) {
      let cell = this.#free.pop();
      if (cell === undefined) {
        // Atlas full: the oldest bubble gives up its cell.
        const oldest = this.#bubbles.reduce((a, b) => (b.ageS > a.ageS ? b : a));
        this.#remove(oldest);
        cell = this.#free.pop() ?? 0;
      }
      bubble = { speaker, cell, ageS: 0, text };
      this.#bubbles.push(bubble);
    }
    bubble.ageS = 0;
    bubble.text = text;
    this.#draw(bubble.cell, text);
  }

  /** Drops a speaker's bubble (they left). */
  forget(speaker: number): void {
    const bubble = this.#bubbles.find((b) => b.speaker === speaker);
    if (bubble) this.#remove(bubble);
  }

  clear(): void {
    for (const bubble of [...this.#bubbles]) this.#remove(bubble);
  }

  /** Ages every bubble by `dt` and drops the expired ones. Call once per frame, before `add`s. */
  begin(dt: number): void {
    this.#count = 0;
    for (let i = this.#bubbles.length - 1; i >= 0; i--) {
      const bubble = this.#bubbles[i];
      if (!bubble) continue;
      bubble.ageS += dt;
      if (bubble.ageS >= CHAT_BUBBLE_S) this.#remove(bubble);
    }
  }

  /** True while `speaker` has a bubble up. */
  has(speaker: number): boolean {
    for (const bubble of this.#bubbles) if (bubble.speaker === speaker) return true;
    return false;
  }

  /**
   * Draws `speaker`'s bubble with its bottom at (x, y, z), `distance` metres from the camera,
   * faded by `fade` (the player's own join/leave fade). Allocates nothing.
   */
  add(speaker: number, x: number, y: number, z: number, distance: number, fade: number): void {
    let bubble: Bubble | undefined;
    for (const b of this.#bubbles) {
      if (b.speaker === speaker) {
        bubble = b;
        break;
      }
    }
    if (!bubble || this.#count >= CELLS) return;
    const i = this.#count++;
    const left = CHAT_BUBBLE_S - bubble.ageS;
    const alpha = fade * Math.min(1, left / CHAT_BUBBLE_FADE_S);
    const scale =
      CHAT_BUBBLE_HEIGHT_M * Math.min(Math.max(distance / NAME_TAG_NEAR_M, 1), NAME_TAG_MAX_SCALE);
    this.mesh.setMatrixAt(i, scratch.compose(pos.set(x, y, z), noRotation, size.setScalar(scale)));
    cellUv(bubble.cell, CHAT_BUBBLE_ATLAS_COLUMNS, CHAT_BUBBLE_ATLAS_ROWS, uv);
    this.#cells.setXY(i, uv.x, uv.y);
    this.#fades.setX(i, alpha);
  }

  end(): void {
    const mesh = this.mesh;
    mesh.count = this.#count;
    mesh.visible = this.#count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    this.#cells.needsUpdate = true;
    this.#fades.needsUpdate = true;
  }

  /** What each speaker's bubble says (the test API; allocates). */
  views(): { speaker: number; text: string; ageS: number }[] {
    return this.#bubbles.map((b) => ({ speaker: b.speaker, text: b.text, ageS: b.ageS }));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
    this.mesh.dispose();
  }

  #remove(bubble: Bubble): void {
    const i = this.#bubbles.indexOf(bubble);
    if (i < 0) return;
    this.#bubbles.splice(i, 1);
    this.#free.push(bubble.cell);
  }

  #rect(cell: number): [number, number, number, number] {
    const column = cell % CHAT_BUBBLE_ATLAS_COLUMNS;
    const row = Math.floor(cell / CHAT_BUBBLE_ATLAS_COLUMNS);
    return [column * CELL_W, row * CELL_H, CELL_W, CELL_H];
  }

  /** A rounded bubble with a tail, sized to the wrapped text, anchored at the cell's bottom. */
  #draw(cell: number, text: string): void {
    const ctx = this.#ctx;
    const [x, y, w, h] = this.#rect(cell);
    ctx.clearRect(x, y, w, h);
    ctx.font = FONT;
    const maxTextW = CHAT_BUBBLE_MAX_W_PX - PAD_X * 2;
    const lines = wrapBubbleText(
      text,
      maxTextW,
      CHAT_BUBBLE_MAX_LINES,
      (s) => ctx.measureText(s).width,
    );
    let textW = 0;
    for (const line of lines) textW = Math.max(textW, ctx.measureText(line).width);
    const boxW = Math.min(textW + PAD_X * 2, CHAT_BUBBLE_MAX_W_PX);
    const boxH = lines.length * LINE_PX + PAD_Y * 2;
    const boxX = x + (w - boxW) / 2;
    const boxY = y + h - TAIL_PX - boxH;
    const midX = x + w / 2;
    ctx.fillStyle = 'rgba(250, 250, 252, 0.95)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 12);
    ctx.moveTo(midX - 7, boxY + boxH - 1);
    ctx.lineTo(midX, y + h - 1);
    ctx.lineTo(midX + 7, boxY + boxH - 1);
    ctx.fill();
    ctx.fillStyle = '#14161f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, k) => {
      ctx.fillText(line, midX, boxY + PAD_Y + LINE_PX * (k + 0.5), maxTextW);
    });
    this.#texture.needsUpdate = true;
  }
}
